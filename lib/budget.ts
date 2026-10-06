import "server-only";
import { get, put } from "@vercel/blob";

/**
 * Spend guards for the public demo, so visitors can't run up the model bill or the Qloo quota:
 * - per visitor (IP): 6 tours per 10 minutes, kept in memory per server instance;
 * - per day: DAILY_MODEL_CAP agent runs in total (default 200), counted in memory and
 *   flushed to a private blob every 10 runs (every run once 80% is spent) so the cap holds across instances.
 * When the model budget runs out, tours still run on the fixed plan and template pitches. Past the per-visitor
 * limit a new tour is refused with a plain message (each tour makes about 40 Qloo calls).
 */
const IP_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 6;
const DAILY_CAP = Number(process.env.DAILY_MODEL_CAP || 200);
const FLUSH_EVERY = 10;

const IP_DAY_LIMIT = Number(process.env.IP_DAILY_MODEL_CAP || 60);
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

let day = "";
let persisted = 0; // count stored in the blob when we last synced
let local = 0; // calls this instance made since then

const today = () => new Date().toISOString().slice(0, 10);
const key = (d: string) => `usage/${d}.json`;

async function readCount(d: string): Promise<{ count: number; etag?: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { count: 0 };
  const r = await get(key(d), { access: "private", useCache: false }).catch(() => null);
  if (!r?.stream) return { count: 0 };
  const j = JSON.parse(await new Response(r.stream).text()) as { count: number };
  return { count: j.count ?? 0, etag: r.blob.etag?.replace(/^W\//, "") }; // If-Match needs the strong form
}

async function flush(): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN || local === 0) return;
  for (let i = 0; i < 3; i++) {
    const cur = await readCount(day);
    try {
      await put(key(day), JSON.stringify({ count: cur.count + local }), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        ...(cur.etag ? { ifMatch: cur.etag } : {}),
      });
      persisted = cur.count + local;
      local = 0;
      return;
    } catch {
      /* someone else wrote first: re-read and retry */
    }
  }
}

/** Takes one model call from today's budget; false when the day's cap is spent. */
export async function takeDaily(): Promise<boolean> {
  const d = today();
  if (d !== day) {
    const count = (await readCount(d).catch(() => ({ count: 0 }))).count;
    if (d !== day) {
      day = d;
      local = 0;
      persisted = count;
    }
  }
  if (persisted + local >= DAILY_CAP) return false;
  local++;
  // Sync every 10 calls, and on every call once the day is 80% spent, so instances can't overshoot by much.
  const near = persisted + local >= DAILY_CAP * 0.8;
  if (local >= FLUSH_EVERY || near) await flush().catch(() => {});
  return true;
}

/** Whether today's model budget allows one more agent run. */
export async function takeModelRun(): Promise<boolean> {
  return takeDaily();
}
