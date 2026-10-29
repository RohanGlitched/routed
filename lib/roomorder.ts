/**
 * Room orders for the outside tests (data/outside2/PROTOCOL-4.md). Pure, so they are tested.
 */

type Scored = { popularity?: number; affinity?: number };

/** 1-based ranks by a score, best first; a missing score ranks after every present one, ties keep list order. */
function ranksBy<T>(xs: T[], score: (x: T) => number | undefined): number[] {
  const order = xs.map((x, i) => ({ i, v: score(x) })).sort((a, b) => (a.v === undefined ? 1 : 0) - (b.v === undefined ? 1 : 0) || (b.v ?? 0) - (a.v ?? 0) || a.i - b.i);
  const out = new Array<number>(xs.length);
  order.forEach((o, k) => (out[o.i] = k + 1));
  return out;
}

/**
 * Qloo's rooms ordered by popularity and fan affinity together: each room's rank by popularity and its rank by
 * affinity on the same list are averaged, with no weight to tune; ties keep Qloo's order.
 */
export function popularityAffinityOrder<T extends Scored>(rooms: T[]): T[] {
  const p = ranksBy(rooms, (r) => r.popularity);
  const a = ranksBy(rooms, (r) => r.affinity);
  return rooms
    .map((r, i) => ({ r, i, s: p[i]! + a[i]! }))
    .sort((x, y) => x.s - y.s || x.i - y.i)
    .map((x) => x.r);
}
