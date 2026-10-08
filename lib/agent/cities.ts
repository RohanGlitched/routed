import { marketId, marketLabel, nearestMarket, type Market, type RegionId } from "../geo/markets";
import type { CityScore } from "../types";

export type HeatArea = { name: string; within: string };

/**
 * Where to ask Qloo for the heatmap: one WKT polygon per region. A tile's affinity and popularity are percentiles
 * within the response they came in (measured: both run evenly from 0 to 1 in every response), so two countries
 * asked separately would each have a "1.0" tile and the smaller one's cities would float up the ranking
 * (Calgary once ranked #1 for Tyler Childers that way). One polygon, one scale. The North America box stops at
 * 60°N and 130°W, which also keeps Alaska and Hawaii out of a tour routed by van.
 */
export const HEAT_AREAS: Record<RegionId, HeatArea[]> = {
  na: [{ name: "North America", within: "POLYGON((-130 24, -52 24, -52 60, -130 60, -130 24))" }],
  uk: [{ name: "the UK and Ireland", within: "POLYGON((-11 49.8, 2 49.8, 2 59, -11 59, -11 49.8))" }],
  eu: [{ name: "mainland Europe", within: "POLYGON((-10 36, 30 36, 30 60, 25 71, 5 62, -10 52, -10 36))" }],
};

export type HeatTile = { lat: number; lon: number; affinity: number; rank?: number; popularity?: number };

/**
 * Turns heatmap tiles into ranked touring markets: each tile goes to the market it sits in (within 60 km), and a
 * market scores its best tile. Qloo's tile affinity is a rank across the whole map (the top 1% all read 0.99+),
 * so on its own it crowns one-tile hot spots (Indio, which is the Coachella grounds). A tile's strength is
 * affinity × popularity: how far fans over-index there times how much taste signal the tile carries at all.
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

export const strength = (t: HeatTile) => t.affinity * (t.popularity ?? 1);

function better(a: HeatTile, b: HeatTile): boolean {
  const d = strength(a) - strength(b);
  if (Math.abs(d) > 1e-6) return d > 0;
  return (a.rank ?? 0) > (b.rank ?? 0);
}
