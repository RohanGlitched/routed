import "server-only";
import { storage } from "./storage";

/**
 * Spend guards for the public demo, so visitors can't run up the model bill or the Qloo quota:
 * - per visitor (IP): 6 tours per 10 minutes and 60 a day, kept in memory per server instance;
 * - per day, across instances: DAILY_MODEL_CAP agent runs (default 200) and QLOO_DAILY_CAP Qloo requests
 *   (default 2,500, about 35 tours), each counted in memory and flushed to a private blob every few takes
 *   (every take once 80% is spent) so the cap holds across instances;
 * - the MCP endpoint has its own small share (MCP_DAILY_CAP tours, default 12) so an outside agent can't spend
 *   the day's model budget before a visitor on the site does.
 * When the model budget runs out, tours still run on the fixed plan and template pitches. When the Qloo allowance
 * runs out, new tours are refused with a plain message and the finished tours on the poster wall still open.
 */
const IP_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 6;
const IP_DAY_LIMIT = Number(process.env.IP_DAILY_TOUR_CAP || process.env.IP_DAILY_MODEL_CAP || 60);
const ipCalls = new Map<string, number[]>();

export function ipAllowed(ip: string): boolean {
  const now = Date.now();
  const list = (ipCalls.get(ip) ?? []).filter((t) => now - t < 86_400_000);
  const recent = list.filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= IP_LIMIT || list.length >= IP_DAY_LIMIT) {
    ipCalls.set(ip, list);
    return false;
  }
  list.push(now);
  ipCalls.set(ip, list);
  if (ipCalls.size > 5000) {
    // Forget the quiet addresses, not everyone.
    for (const [k, v] of ipCalls) if (!v.some((t) => now - t < IP_WINDOW_MS)) ipCalls.delete(k);
  }
  return true;
}

const today = () => new Date().toISOString().slice(0, 10);

/** One daily counter persisted in a blob, shared by every instance, with a cap. */
class Counter {
  private day = "";
  private persisted = 0; // count stored in the blob when we last synced
  private local = 0; // takes this instance made since then
  constructor(
    readonly name: string,
    readonly cap: number,
    readonly flushEvery: number,
  ) {}

  private key(d: string) {
    return `usage/${this.name}-${d}.json`;
  }

  private async read(d: string): Promise<{ count: number; etag?: string }> {
    const s = storage();
    if (!s) return { count: 0 };
    const r = await s.read(this.key(d)).catch(() => null);
    if (!r) return { count: 0 };
    const j = JSON.parse(r.text) as { count: number };
    return { count: j.count ?? 0, etag: r.etag };
  }

  private async flush(): Promise<void> {
    const s = storage();
    if (!s || this.local === 0) return;
    for (let i = 0; i < 3; i++) {
      const cur = await this.read(this.day);
      try {
        await s.write(this.key(this.day), JSON.stringify({ count: cur.count + this.local }), { ifMatch: cur.etag });
        this.persisted = cur.count + this.local;
        this.local = 0;
        return;
      } catch {
        /* someone else wrote first: re-read and retry */
      }
    }
  }

  private async roll(): Promise<void> {
    const d = today();
    if (d === this.day) return;
    const count = (await this.read(d).catch(() => ({ count: 0 }))).count;
    if (d !== this.day) {
      this.day = d;
      this.local = 0;
      this.persisted = count;
    }
  }

  /** Takes `n` from today's allowance; false (and nothing taken) when it would pass the cap. */
  async take(n = 1): Promise<boolean> {
    await this.roll();
    if (this.persisted + this.local + n > this.cap) return false;
    this.local += n;
    const near = this.persisted + this.local >= this.cap * 0.8;
    if (this.local >= this.flushEvery || near) await this.flush().catch(() => {});
    return true;
  }

  /** What is left today, as last synced. */
  async remaining(): Promise<number> {
    await this.roll();
    return Math.max(0, this.cap - this.persisted - this.local);
  }
}

const model = new Counter("model", Number(process.env.DAILY_MODEL_CAP || 200), 10);
const qloo = new Counter("qloo", Number(process.env.QLOO_DAILY_CAP || 2500), 25);
const mcp = new Counter("mcp", Number(process.env.MCP_DAILY_CAP || 12), 1);

/** Whether today's model budget allows one more agent run. */
export const takeModelRun = () => model.take();
/** One Qloo request against today's allowance. */
export const takeQloo = () => qloo.take();
/** Qloo requests left today. A tour needs about 70. */
export const qlooRemaining = () => qloo.remaining();
/** Whether the MCP endpoint may route one more tour today. */
export const takeMcpRun = () => mcp.take();

/** Qloo requests a tour needs, with margin, for refusing a tour that couldn't finish. */
export const QLOO_PER_TOUR = 90;
