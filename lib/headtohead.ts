import { MARKETS, marketId, type RegionId } from "./geo/markets";
import { hotSpot, kmBetween, placeHeat, type LocalPoint, type LocalTile } from "./geo/local";

/**
 * The head-to-head: what Qloo's taste data changes, measured on a ruler Qloo didn't make (the cities artists
 * really played). Pure functions only, so the scoring is tested; the protocol is in scripts/head-to-head.ts and
 * the results in data/head-to-head/results.json.
 *
 * Every method ranks the same universe (every touring market in the tour's region). For an artist whose real tour
 * played R markets in that region, a method's score is how many of its top R the artist really played, over R
 * (R-precision: "pick as many cities as the artist played; how many are right?"). It doesn't saturate the way eight
 * picks against a forty-city arena run do, and every method is held to the same number of picks.
 */

const popOrder = new Map<RegionId, string[]>();

/** Every touring market in a region, biggest metro population first (the obvious prior). */
export function populationRanking(region: RegionId): string[] {
  let v = popOrder.get(region);
  if (!v) {
    v = MARKETS.filter((m) => m.region === region)
      .sort((a, b) => b.pop - a.pop)
      .map(marketId);
    popOrder.set(region, v);
  }
  return v;
}

/** A partial ranking made whole: its own ids first (duplicates and other regions' ids dropped), then the rest by population. */
export function completeRanking(ids: (string | undefined | null)[], region: RegionId): string[] {
  const universe = new Set(populationRanking(region));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id) || !universe.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of populationRanking(region)) if (!seen.has(id)) out.push(id);
  return out;
}

/**
 * Qloo and population together, with no weight to tune: each market's place in the Qloo ranking and its place
 * by population are averaged, and the averages sorted (ties go to the bigger city).
 */
export function blendRanking(qloo: string[], region: RegionId): string[] {
  return blendTwo(qloo, populationRanking(region), region);
}

/** Any two rankings averaged the same way (the exploratory model + Qloo blend uses it); ties go to the bigger city. */
export function blendTwo(a: string[], b: string[], region: RegionId): string[] {
  const pop = populationRanking(region);
  const x = new Map(completeRanking(a, region).map((id, i) => [id, i]));
  const y = new Map(completeRanking(b, region).map((id, i) => [id, i]));
  const p = new Map(pop.map((id, i) => [id, i]));
  return [...pop].sort((m, n) => x.get(m)! + y.get(m)! - (x.get(n)! + y.get(n)!) || p.get(m)! - p.get(n)!);
}

export type Hit = { hits: number; of: number; ids: string[] };

/** How many of a ranking's top R the artist really played, R being the number of markets on the real tour. */
export function rPrecision(ranking: string[], truth: Set<string>): Hit {
  const top = ranking.slice(0, truth.size);
  const ids = top.filter((id) => truth.has(id));
  return { hits: ids.length, of: truth.size, ids };
}

/**
 * The cities population alone misses: the real tour's markets outside population's top R. How many of those did
 * a ranking's top R find? Population scores zero here by construction; it is the part of a tour Qloo is for.
 */
export function beyondBiggest(ranking: string[], truth: Set<string>, region: RegionId): Hit {
  const big = new Set(populationRanking(region).slice(0, truth.size));
  const small = [...truth].filter((id) => !big.has(id));
  const top = new Set(ranking.slice(0, truth.size));
  const ids = small.filter((id) => top.has(id));
  return { hits: ids.length, of: small.length, ids };
}

/** The region's biggest markets left out of the secondary-market test (data/outside2/PROTOCOL-3.md). */
export const SECONDARY_TOP = 25;

/**
 * R-precision on secondary markets only (data/outside2/PROTOCOL-3.md): the region's `top` biggest markets by
 * population are removed from the ranking and from the real tour, the ranking keeps its order, and R is the number of
 * the tour's markets left. Where model memory and city size help least, how many of those did a ranking's top R find?
 */
export function secondaryRPrecision(ranking: string[], truth: Set<string>, region: RegionId, top = SECONDARY_TOP): Hit {
  const big = new Set(populationRanking(region).slice(0, top));
  return rPrecision(
    ranking.filter((id) => !big.has(id)),
    new Set([...truth].filter((id) => !big.has(id))),
  );
}

/** Share of a tour's cities that were on the real tour (the eight-pick check). Unplaced stops are left out. */
export function precision(stops: (string | undefined)[], truth: Set<string>): Hit {
  const placed = stops.filter((x): x is string => Boolean(x));
  const ids = placed.filter((id) => truth.has(id));
  return { hits: ids.length, of: placed.length, ids };
}

/** Exact two-sided sign test on paired differences (ties dropped). */
export function signTest(diffs: number[], eps = 1e-9): { wins: number; losses: number; ties: number; p: number } {
  const wins = diffs.filter((d) => d > eps).length;
  const losses = diffs.filter((d) => d < -eps).length;
  const ties = diffs.length - wins - losses;
  const n = wins + losses;
  if (!n) return { wins, losses, ties, p: 1 };
  const k = Math.min(wins, losses);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += choose(n, i);
  return { wins, losses, ties, p: Math.min(1, (2 * tail) / 2 ** n) };
}

function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** A seeded generator (mulberry32), so the bootstrap interval is the same on every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The mean paired difference with a 95% percentile bootstrap interval (artists resampled with replacement). */
export function meanCI(diffs: number[], seed = 20261018, n = 10_000): { mean: number; lo: number; hi: number } {
  const mean = avg(diffs);
  if (diffs.length < 2) return { mean, lo: mean, hi: mean };
  const r = rng(seed);
  const means: number[] = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < diffs.length; j++) s += diffs[Math.floor(r() * diffs.length)]!;
    means.push(s / diffs.length);
  }
  means.sort((a, b) => a - b);
  return { mean, lo: means[Math.floor(0.025 * n)]!, hi: means[Math.ceil(0.975 * n) - 1]! };
}

export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Pooled share: total hits over total picks. */
export const pooled = (xs: Hit[]) => {
  const hits = xs.reduce((n, x) => n + x.hits, 0);
  const of = xs.reduce((n, x) => n + x.of, 0);
  return { hits, of, share: of ? hits / of : 0 };
};

/** The club and theatre subset's ceiling (data/outside2/PROTOCOL-5.md): real rooms of this many or fewer. */
export const CLUB_THEATRE_MAX = 3000;

/**
 * A tour's room size from its venues' capacities, the way the venue test sets a crowd (scripts/outside2.ts truth):
 * the lower middle value, rounded to the nearest 100 (a room under 50 keeps its own number).
 */
export function medianCapacity(capacities: number[]): number | null {
  if (!capacities.length) return null;
  const s = [...capacities].sort((a, b) => a - b);
  const mid = s[Math.floor((s.length - 1) / 2)]!;
  return Math.round(mid / 100) * 100 || s[0]!;
}

/** In the club and theatre subset: a known room size of CLUB_THEATRE_MAX or fewer. An unknown size is out. */
export const isClubAndTheatre = (size: number | null | undefined, max = CLUB_THEATRE_MAX) => typeof size === "number" && size > 0 && size <= max;

/* ───────────── the street-level check (data/outside2/PROTOCOL-6.md) ───────────── */

/** The lower middle value (the same convention as medianCapacity), or null for an empty list. */
export function lowerMedian(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

/**
 * Where a place sits on a stop's street heatmap: km to the hottest tile (unrounded) and the strength of the
 * strongest kept tile within 0.35 km (placeHeat's rule; 0 when no kept tile is that close).
 */
export function streetSpot(tiles: LocalTile[], place: LocalPoint): { km: number; strength: number } | null {
  const hot = hotSpot(tiles);
  const h = placeHeat(tiles, place);
  if (!hot || !h) return null;
  return { km: kmBetween(hot, place), strength: h.strength };
}

/** How far the farthest kept tile lies from a point (the reach of the heatmap around the city centre). */
export function tileReachKm(tiles: LocalTile[], centre: LocalPoint): number {
  return tiles.reduce((m, t) => Math.max(m, kmBetween(centre, { lat: t[0], lon: t[1] })), 0);
}

/**
 * The share of the other rooms that sit farther from the hottest tile than the real room (ties count half):
 * 1 means the real room is the closest of all, 0.5 is what a room picked at random would score.
 */
export function shareFarther(realKm: number, othersKm: number[], eps = 1e-9): number | null {
  if (!othersKm.length) return null;
  let n = 0;
  for (const k of othersKm) n += k > realKm + eps ? 1 : Math.abs(k - realKm) <= eps ? 0.5 : 0;
  return n / othersKm.length;
}
