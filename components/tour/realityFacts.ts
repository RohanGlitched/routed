import type { QlooDiff } from "@/lib/types";

/**
 * The flagship against the artist's real tours, as numbers the panel, the banner and the deck print. Pure (no
 * React, no CSS), tested in test/reality.test.ts; the data is data/flagship-reality.json, read on the server by
 * app/tour/[id]/reality.ts. Every figure here is counted from that file or the stored tour, none is typed.
 */

/** The tour the reality check is about, and the deck's "flagship": the tour the live final presents. */
export const FLAGSHIP = "8v4ce57nx6";

/** A market the artist played before the headline tour, or as a support act, with the listing that says so. */
export type PastDate = { year: string; venue: string; note?: string; finale?: boolean; source: string };

export type RealityCheck = {
  artist: string;
  checked: string;
  tour: { name: string; years: string; source: string };
  /** `routedCity` names the Routed city a real stop stands for when the names differ ("Morrison, CO" is Denver). */
  realCities: { city: string; played: boolean; venue: string; capacity?: number; capacitySource?: string; routedCity?: string }[];
  routedCities: { city: string; onRealTour: boolean; venue?: string; played?: PastDate }[];
  summary: string;
  usualCrowd?: { input: number; inputScale?: string; realMedian?: number; note: string };
  sources: { title: string; url: string }[];
};

/** "Portland, OR" → "portland"; "Morrison, CO (Denver area)" → "morrison". */
export const cityKey = (city: string) => city.replace(/\(.*?\)/g, "").split(",")[0]!.trim().toLowerCase();

/**
 * Which Routed city each real stop stands for (undefined when none). An explicit `routedCity` wins; a stop without
 * one matches on its name with the state stripped, unless another stop claims that Routed city explicitly (so
 * "Portland, ME" never stands in for Routed's Portland when "Portland, OR" does).
 */
export function realityMatches(r: Pick<RealityCheck, "realCities" | "routedCities">): (string | undefined)[] {
  const routed = new Map(r.routedCities.map((c) => [cityKey(c.city), c.city]));
  const claimed = new Set(r.realCities.filter((c) => c.routedCity).map((c) => cityKey(c.routedCity!)));
  return r.realCities.map((c) => {
    if (c.routedCity) return routed.get(cityKey(c.routedCity));
    const k = cityKey(c.city);
    return claimed.has(k) ? undefined : routed.get(k);
  });
}

/** How many of Routed's cities were on the headline tour: "2 of 8". */
export function realityCount(r: RealityCheck): { on: number; of: number } {
  return { on: r.routedCities.filter((c) => c.onRealTour).length, of: r.routedCities.length };
}

/** How many of Routed's cities are markets the artist played in the listings read (headline, past or support). */
export function playedCount(r: RealityCheck): { played: number; of: number; years: string } {
  const years = [...r.routedCities.flatMap((c) => (c.played ? [c.played.year] : [])), ...r.tour.years.split(/[^\d]+/).filter(Boolean)].map(Number).filter((y) => y > 1900);
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return { played: r.routedCities.filter((c) => c.onRealTour || c.played).length, of: r.routedCities.length, years: lo === hi ? `${lo}` : `${lo}–${String(hi).slice(-2)}` };
}

/** Routed's cities on none of the listings read. */
export const realityMisses = (r: RealityCheck) => r.routedCities.filter((c) => !c.onRealTour && !c.played).map((c) => c.city);

/** The real rooms with a published capacity: smallest, largest. */
export function realRooms(r: RealityCheck): { min: number; max: number; n: number } | undefined {
  const caps = r.realCities.flatMap((c) => (c.capacity ? [c.capacity] : []));
  return caps.length ? { min: Math.min(...caps), max: Math.max(...caps), n: caps.length } : undefined;
}

const n0 = (v: number) => v.toLocaleString("en-US");

/** "Routed at her 2024-scale crowd (1,500); her 2026 rooms run 1,850–9,525" (word joiners keep the range on one line). */
export function scaleLine(r: RealityCheck): string | undefined {
  const rooms = realRooms(r);
  const c = r.usualCrowd;
  if (!rooms || !c) return undefined;
  return `Routed at her ${c.inputScale ? `${c.inputScale}-scale ` : ""}crowd (${n0(c.input)}); her ${r.tour.years} rooms run ${n0(rooms.min)}\u2060–\u2060${n0(rooms.max)}`;
}

/**
 * The finding that leads: Qloo's strongest fan city, when the artist ended a tour there. "Qloo's #1 fan city,
 * #238 by size, is where she closed her 2025 tour". The ranks come from the tour's own Qloo diff.
 */
export function realityLead(r: RealityCheck, diff?: Pick<QlooDiff, "added">, stops?: { city: string; score: { rank: number } }[]): { city: string; text: string } | undefined {
  const rank = (city: string) => stops?.find((s) => s.city === city)?.score.rank ?? diff?.added.find((a) => a.city === city)?.fanRank;
  const finale = r.routedCities.filter((c) => c.played?.finale && rank(c.city) !== undefined).sort((a, b) => rank(a.city)! - rank(b.city)!)[0];
  if (!finale) return undefined;
  const pop = diff?.added.find((a) => a.city === finale.city)?.popRank;
  return { city: finale.city, text: `Qloo's #${rank(finale.city)} fan city${pop ? `, #${pop} by size,` : ""} is where she closed her ${finale.played!.year} tour` };
}
