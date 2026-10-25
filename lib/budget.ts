import "server-only";
import { storage } from "./storage";

/**
 * Spend guards for the public demo, so visitors can't run up the model bill or the Qloo quota:
 * - per visitor (IP): 6 tours per 10 minutes and 60 a day, kept in memory per server instance;
 * - per day, across instances: DAILY_MODEL_CAP agent runs (default 200) and QLOO_DAILY_CAP Qloo requests
 *   (default 2,500, about 35 tours), each counted in memory and flushed to a private blob every few takes
 *   (every take once 80% is spent) so the cap holds across instances;
 * - per hour, the same way: HOURLY_MODEL_CAP runs and QLOO_HOURLY_CAP requests (default a quarter of the day's),
 *   so one burst can't spend the whole day and leave nothing for the judges of a later hour;
 * - the MCP endpoint has its own small share (MCP_DAILY_CAP tours, default 12) so an outside agent can't spend
 *   the day's model budget before a visitor on the site does.
 * When the model budget runs out, tours still run on the fixed plan and template pitches. When the Qloo allowance
 * runs out, a new tour is answered with the stored tour for that artist, or the nearest one on the poster wall,
 * flagged as stored (app/api/tours/route.ts).
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

type Period = "day" | "hour";
/** "2026-11-03" for a day, "2026-11-03T14" for an hour (UTC). The day keys are the ones used before Oct 25. */
const stamp = (p: Period) => new Date().toISOString().slice(0, p === "day" ? 10 : 13);
/** How stale a counter's view of the other instances may get before `remaining()` re-reads the blob. */
const REFRESH_MS = 30_000;

/** One counter per day or per hour, persisted in a blob shared by every instance, with a cap. */
class Counter {
  private period = "";
  private persisted = 0; // count stored in the blob when we last synced
  private local = 0; // takes this instance made since then
  private readAt = 0;
  constructor(
    readonly name: string,
    readonly cap: number,
    readonly flushEvery: number,
    readonly per: Period = "day",
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
      const cur = await this.read(this.period);
      const next = Math.max(0, cur.count + this.local);
      try {
        await s.write(this.key(this.period), JSON.stringify({ count: next }), { ifMatch: cur.etag });
        this.persisted = next;
        this.local = 0;
        this.readAt = Date.now();
        return;
      } catch {
        /* someone else wrote first: re-read and retry */
      }
    }
  }

  private async roll(): Promise<void> {
    const d = stamp(this.per);
    if (d === this.period) return;
    const count = (await this.read(d).catch(() => ({ count: 0 }))).count;
    if (d !== this.period) {
      this.period = d;
      this.local = 0;
      this.persisted = count;
      this.readAt = Date.now();
    }
  }

  /** Takes `n` from this period's allowance; false (and nothing taken) when it would pass the cap. */
  async take(n = 1): Promise<boolean> {
    await this.roll();
    if (this.persisted + this.local + n > this.cap) return false;
    this.local += n;
    const near = this.persisted + this.local >= this.cap * 0.8;
    if (this.local >= this.flushEvery || near) await this.flush().catch(() => {});
    return true;
  }

  /** Hands back `n` taken a moment ago, when another cap refused the same request. */
  give(n = 1): void {
    this.local -= n;
  }

  /** What is left this period. Re-reads the shared count when the last read is older than half a minute, so the
   *  number on the form reflects the other instances' takes too. */
  async remaining(): Promise<number> {
    await this.roll();
    if (storage() && Date.now() - this.readAt > REFRESH_MS) {
      const period = this.period;
      const cur = await this.read(period).catch(() => null);
      if (cur && period === this.period) {
        this.persisted = cur.count;
        this.readAt = Date.now();
      }
    }
    return Math.max(0, this.cap - this.persisted - this.local);
  }
}

const cap = (v: string | undefined, fallback: number) => (v && Number(v) > 0 ? Math.floor(Number(v)) : fallback);

const MODEL_DAY = cap(process.env.DAILY_MODEL_CAP, 200);
const QLOO_DAY = cap(process.env.QLOO_DAILY_CAP, 2500);
const model = new Counter("model", MODEL_DAY, 10);
const modelHour = new Counter("model-hour", cap(process.env.HOURLY_MODEL_CAP, Math.max(4, Math.ceil(MODEL_DAY / 4))), 5, "hour");
const qloo = new Counter("qloo", QLOO_DAY, 25);
const qlooHour = new Counter("qloo-hour", cap(process.env.QLOO_HOURLY_CAP, Math.max(180, Math.ceil(QLOO_DAY / 4))), 25, "hour");
const mcp = new Counter("mcp", cap(process.env.MCP_DAILY_CAP, 12), 1);

/** Takes one from this hour's allowance and today's, or from neither. */
async function takeBoth(hour: Counter, day: Counter): Promise<boolean> {
  if (!(await hour.take())) return false;
  if (await day.take()) return true;
  hour.give();
  return false;
}

/** Whether this hour's and today's model budget allow one more agent run. */
export const takeModelRun = () => takeBoth(modelHour, model);
/** One Qloo request against this hour's and today's allowance. */
export const takeQloo = () => takeBoth(qlooHour, qloo);
/** Qloo requests that can still be made now: the smaller of what is left today and this hour. A tour needs about 70. */
export const qlooRemaining = async () => Math.min(await qloo.remaining(), await qlooHour.remaining());
/** Whether the MCP endpoint may route one more tour today. */
export const takeMcpRun = () => mcp.take();

/** Qloo requests a tour needs, with margin, for refusing a tour that couldn't finish. */
export const QLOO_PER_TOUR = 90;

export type ToursLeft = {
  /** New tours the Qloo allowance still covers today, and this hour (never more than today). */
  today: number;
  hour: number;
  /** Which cap is in the way when no tour can start now. */
  limit?: "day" | "hour";
  /** When this hour's allowance comes back (the top of the next UTC hour), ISO. */
  nextHour: string;
};

/** Tours left today and this hour, for the form and for deciding whether a new tour may start. */
export async function toursLeft(): Promise<ToursLeft> {
  const [day, hour] = await Promise.all([qloo.remaining(), qlooHour.remaining()]);
  const today = Math.floor(day / QLOO_PER_TOUR);
  const thisHour = Math.min(today, Math.floor(hour / QLOO_PER_TOUR));
  const next = new Date();
  next.setUTCMinutes(60, 0, 0);
  const limit: ToursLeft["limit"] = thisHour > 0 ? undefined : today === 0 ? "day" : "hour";
  return { today, hour: thisHour, ...(limit ? { limit } : {}), nextHour: next.toISOString() };
}
