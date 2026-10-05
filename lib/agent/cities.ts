import { marketId, marketLabel, nearestMarket, type Market, type RegionId } from "../geo/markets";
import type { CityScore } from "../types";

/** Where to ask Qloo for the heatmap, per region. Several areas when one name doesn't cover the region. */
export const HEAT_AREAS: Record<RegionId, string[]> = {
  na: (process.env.QLOO_HEAT_NA ?? "United States|Canada").split("|"),
  uk: (process.env.QLOO_HEAT_UK ?? "United Kingdom|Ireland").split("|"),
  eu: (process.env.QLOO_HEAT_EU ?? "Europe").split("|"),
};

export type HeatTile = { lat: number; lon: number; affinity: number; rank?: number; popularity?: number };

/**
 * Turns heatmap tiles into ranked touring markets: each tile goes to the market it sits in (within 60 km), and a
 * market scores its best tile. Ranked by affinity, then by the tile's rank among the artist's own tiles, then
 * by popularity (how much signal is there), so a tiny hot tile in a big city doesn't beat a whole hot city by noise.
 */
export function scoreCities(tiles: HeatTile[], region: RegionId): CityScore[] {
  const by = new Map<string, { m: Market; best: HeatTile; n: number }>();
  for (const t of tiles) {
    const m = nearestMarket(t, region);
    if (!m) continue;
    const id = marketId(m);
    const cur = by.get(id);
    if (!cur) by.set(id, { m, best: t, n: 1 });
    else {
      cur.n++;
      if (better(t, cur.best)) cur.best = t;
    }
  }
  return [...by.values()]
    .sort((a, b) => (better(a.best, b.best) ? -1 : better(b.best, a.best) ? 1 : b.m.pop - a.m.pop))
    .map(({ m, best, n }, i) => ({
      marketId: marketId(m),
      name: m.name,
      label: marketLabel(m),
      lat: m.lat,
      lon: m.lon,
      affinity: round(best.affinity),
      ...(best.rank !== undefined ? { affinityRank: round(best.rank) } : {}),
      ...(best.popularity !== undefined ? { popularity: round(best.popularity) } : {}),
      tiles: n,
      rank: i + 1,
    }));
}

const round = (v: number) => Math.round(v * 1000) / 1000;

function better(a: HeatTile, b: HeatTile): boolean {
  if (Math.abs(a.affinity - b.affinity) > 0.005) return a.affinity > b.affinity;
  if ((a.rank ?? 0) !== (b.rank ?? 0)) return (a.rank ?? 0) > (b.rank ?? 0);
  return (a.popularity ?? 0) > (b.popularity ?? 0);
}
