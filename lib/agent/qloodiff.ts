import { marketById, type RegionId } from "../geo/markets";
import { blendRanking, populationRanking } from "../headtohead";
import type { CityScore, QlooDiff } from "../types";

/**
 * Qloo as a measured signal on every tour, not a claim. Two pure pieces, so both are tested:
 * - the blend (C2a): the ranking that won the held-out head-to-head (Qloo + population beat population alone by
 *   7.4 points, p < 0.001) is the order the agent and the fixed plan read the cities in;
 * - the diff (C2c): the same city rules re-run on city size alone, and the stops that differ, with Qloo's evidence.
 */

export type Ranks = { blend: Map<string, number>; pop: Map<string, number> };

const popRanks = new Map<RegionId, Map<string, number>>();

/** Each market's place by metro population in its region (1 = biggest). */
export function sizeRanks(region: RegionId): Map<string, number> {
  let v = popRanks.get(region);
  if (!v) {
    v = new Map(populationRanking(region).map((id, i) => [id, i + 1]));
    popRanks.set(region, v);
  }
  return v;
}

/**
 * The cities Qloo found fans in, in blend order: each city's place on the artist's heatmap averaged with its place
 * by population (lib/headtohead.ts blendRanking, unchanged from the test). Every CityScore keeps its own `rank`,
 * which stays the Qloo fan rank the call sheet, the anchor rule and the pitches quote.
 */
export function blendOrder(cities: CityScore[], region: RegionId): { ordered: CityScore[]; ranks: Ranks } {
  const byId = new Map(cities.map((c) => [c.marketId, c]));
  const ordered = blendRanking(cities.map((c) => c.marketId), region)
    .filter((id) => byId.has(id))
    .map((id) => byId.get(id)!);
  // A city outside the region's market list can't be blended; it keeps Qloo's order at the end.
  const seen = new Set(ordered.map((c) => c.marketId));
  for (const c of cities) if (!seen.has(c.marketId)) ordered.push(c);
  return { ordered, ranks: { blend: new Map(ordered.map((c, i) => [c.marketId, i + 1])), pop: sizeRanks(region) } };
}

/**
 * The tour against the size-only plan: which cities Qloo put on the tour that city size wouldn't have (with the
 * fan rank and size rank behind each), and which big cities size alone would have played instead.
 */
export function qlooDiff(tour: { marketId: string; name: string }[], population: string[], cities: CityScore[], region: RegionId): QlooDiff {
  const pop = sizeRanks(region);
  const fan = new Map(cities.map((c) => [c.marketId, c]));
  const inPop = new Set(population);
  const inTour = new Set(tour.map((t) => t.marketId));
  const added = tour
    .filter((t) => !inPop.has(t.marketId))
    .map((t) => {
      const c = fan.get(t.marketId);
      return { marketId: t.marketId, city: c?.name ?? t.name, fanRank: c?.rank ?? 0, popRank: pop.get(t.marketId) ?? 0, affinity: c?.affinity ?? 0 };
    })
    .sort((a, b) => a.fanRank - b.fanRank);
  const dropped = population
    .filter((id) => !inTour.has(id))
    .map((id) => {
      const c = fan.get(id);
      return { marketId: id, city: c?.name ?? marketById(id)?.name ?? id, popRank: pop.get(id) ?? 0, ...(c ? { fanRank: c.rank } : {}) };
    })
    .sort((a, b) => a.popRank - b.popRank);
  return { added, dropped, kept: tour.length - added.length, population };
}

/** The call-sheet line for the diff. */
export function diffLine(d: QlooDiff, stops: number): { text: string; result: string } {
  if (!d.added.length) return { text: `Re-planned on city size alone (same rules, no Qloo, no model): it picks the same ${stops} cities.`, result: "On this tour Qloo's map and city size agree" };
  return {
    text: `Re-planned on city size alone (same rules, no Qloo, no model): Qloo changed ${d.added.length} of ${stops} stops.`,
    result: `Qloo added ${d.added.map((a) => `${a.city} (fan #${a.fanRank}, size #${a.popRank})`).join(", ")}; size alone would play ${d.dropped.map((x) => `${x.city} (size #${x.popRank}${x.fanRank ? `, fan #${x.fanRank}` : ", no fan signal"})`).join(", ")}`,
  };
}
