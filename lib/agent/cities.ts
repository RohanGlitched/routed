import { marketId, marketLabel, nearestMarket, type Market, type RegionId } from "../geo/markets";
import type { CityScore } from "../types";

export type HeatArea = { name: string; within: string };

/**
 * Where to ask Qloo for the heatmap, per region: a locality name Qloo resolves, or a WKT polygon where no name
 * works. ("Europe" resolves to a street in Colombes, near Paris, so the continent is drawn as a polygon.)
 */
export const HEAT_AREAS: Record<RegionId, HeatArea[]> = {
  na: [
    { name: "the United States", within: "United States" },
    { name: "Canada", within: "Canada" },
  ],
  uk: [
    { name: "the United Kingdom", within: "United Kingdom" },
    { name: "Ireland", within: "Ireland" },
  ],
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
