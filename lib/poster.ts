import { posterMap } from "./geo/map";
import type { PosterProps } from "@/components/poster/Poster";
import type { Plan } from "./types";

const REGION_NAME = { na: "North America", uk: "UK and Ireland", eu: "Europe" } as const;

/** "2027-03-12" → "Spring 2027": how a tour is named on a poster. */
export function season(iso: string): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const name = m <= 2 || m === 12 ? "Winter" : m <= 5 ? "Spring" : m <= 8 ? "Summer" : "Fall";
  return `${name} ${m === 12 ? y + 1 : y}`;
}

/** Everything the poster needs from a plan (works with a partial plan while it streams in). */
/** "Austin City Limits Live (ACL Live & 3TEN ACL Live)" → "Austin City Limits Live": a poster line, not a listing. */
export function shortVenue(name?: string): string | undefined {
  if (!name) return undefined;
  const v = name.replace(/\s*\([^)]*\)/g, "").split(/\s+[|–—-]\s+|,\s/)[0]!.trim();
  return v.length > 34 ? `${v.slice(0, 33).trimEnd()}…` : v;
}

export function posterFor(plan: Partial<Plan>): PosterProps | null {
  if (!plan.artist || !plan.region) return null;
  const stops = plan.stops ?? [];
  const map = posterMap(plan.region, plan.heat ?? [], stops, plan.from);
  return {
    artist: plan.artist.name,
    season: season(plan.firstDate ?? new Date().toISOString().slice(0, 10)),
    region: REGION_NAME[plan.region],
    dots: map.dots,
    route: map.route,
    start: map.start,
    stops: stops.map((s) => ({ date: s.date, city: s.city, venue: shortVenue((s.rooms.find((r) => r.id === s.roomId) ?? s.rooms[0])?.name) })),
    // The stamp names the strongest fan city on this tour, not a city the route skipped.
    topCity: stops.length ? [...stops].sort((a, b) => a.score.rank - b.score.rank)[0]!.city : plan.cities?.[0]?.name,
  };
}
