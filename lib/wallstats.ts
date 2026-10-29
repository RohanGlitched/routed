import type { TourRecord } from "./types";

/**
 * What the poster-wall tours actually cost and how the agent loop did on them, computed from the stored records,
 * so /how and the README quote measured figures instead of hard-coded ones ("about 70 Qloo calls" read 81-104).
 */
export type WallStats = {
  tours: number;
  qloo: { min: number; max: number; median: number };
  model: { min: number; max: number };
  tokens: { min: number; max: number };
  /** check_plan on the first booking, what was still open after the agent's last round, and the rounds taken. */
  loop: { raised: number; open: number; cleared: number; worse: number; tours: number };
  /** Booked rooms with no confirmed capacity, of all booked rooms. */
  unmeasured: number;
  rooms: number;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function wallStats(tours: TourRecord[]): WallStats | null {
  const done = tours.filter((t) => t.status === "done" && t.plan?.stops?.length && t.engine?.usage);
  if (!done.length) return null;
  const u = done.map((t) => t.engine!.usage!);
  const checks = done.map((t) => t.engine?.check).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const stops = done.flatMap((t) => t.plan!.stops);
  return {
    tours: done.length,
    qloo: { min: Math.min(...u.map((x) => x.qloo)), max: Math.max(...u.map((x) => x.qloo)), median: median(u.map((x) => x.qloo)) },
    model: { min: Math.min(...u.map((x) => x.modelCalls)), max: Math.max(...u.map((x) => x.modelCalls)) },
    tokens: { min: Math.min(...u.map((x) => x.tokensIn + x.tokensOut)), max: Math.max(...u.map((x) => x.tokensIn + x.tokensOut)) },
    loop: {
      raised: checks.reduce((n, c) => n + c.before, 0),
      open: checks.reduce((n, c) => n + c.after, 0),
      // Per tour, what the agent's rounds closed of the first booking's objections (never below zero: a round that
      // added objections closed none).
      cleared: checks.reduce((n, c) => n + Math.max(0, c.before - c.after), 0),
      worse: checks.filter((c) => c.after > c.before).length,
      tours: checks.length,
    },
    unmeasured: stops.filter((s) => !(s.rooms.find((r) => r.id === s.roomId) ?? s.rooms[0])?.capacity).length,
    rooms: stops.length,
  };
}

/** "81 to 104" or "87" when the two are equal. */
export const span = (a: number, b: number, f: (v: number) => string = (v) => v.toLocaleString("en-US")) => (a === b ? f(a) : `${f(a)} to ${f(b)}`);
