import type { Audience, CityScore, Guess, Named, Opener, Plan, Room, Spot, Stop, TourRecord } from "./types";

/**
 * A tour as it leaves the server (M8: Qloo's developer terms, no Qloo response data published): only what the
 * pages draw. The poster's heatmap is snapped to a grid finer than its dots can show, with one normalised strength
 * per cell; cities keep their place on the fan map, not Qloo's raw scores; rooms, openers and the audience keep the
 * figures the tour book prints and lose the rest. The stored record is untouched, so the pitches, the re-checks and
 * the MCP tools still read everything.
 */

/** Grid step for the poster heatmap, in degrees (about 28 km; the poster spreads each tile over ~130 km). */
export const HEAT_STEP = 0.25;

/** The heatmap as the poster needs it: one cell per grid square, its strongest tile's normalised strength. */
export function snapHeat(heat: Plan["heat"]): Plan["heat"] {
  if (!heat.length) return [];
  const strength = heat.map((t) => t.affinity * (t.popularity ?? 1));
  const lo = Math.min(...strength), hi = Math.max(...strength);
  const cells = new Map<string, { lat: number; lon: number; w: number }>();
  heat.forEach((t, i) => {
    const lat = Math.round(t.lat / HEAT_STEP) * HEAT_STEP, lon = Math.round(t.lon / HEAT_STEP) * HEAT_STEP;
    const w = hi > lo ? (strength[i]! - lo) / (hi - lo) : 1;
    const k = `${lat},${lon}`;
    const cur = cells.get(k);
    if (!cur || w > cur.w) cells.set(k, { lat: +lat.toFixed(2), lon: +lon.toFixed(2), w });
  });
  return [...cells.values()].map((c) => ({ lat: c.lat, lon: c.lon, affinity: Math.round(c.w * 100) / 100 }));
}

/** A city by its place on the fan map: no affinity, taste signal or tile count. */
const city = (c: CityScore): CityScore => ({ marketId: c.marketId, name: c.name, label: c.label, lat: c.lat, lon: c.lon, rank: c.rank }) as CityScore;
/** A room as the day sheet prints it: its fan affinity, capacity and place, not Qloo's popularity or rating. */
const room = ({ popularity: _p, rating: _r, ...r }: Room): Room => r;
const opener = ({ popularity: _p, ...o }: Opener): Opener => o;
const spot = ({ affinity: _a, ...s }: Spot): Spot => s;
const named = ({ affinity: _a, ...n }: Named): Named => n;

function audience(a: Audience): Audience {
  const list = (x?: Named[]) => x?.map(named);
  return {
    ...a,
    tags: a.tags.map(named),
    brands: a.brands.map(named),
    ...(a.taste ? { taste: { music: list(a.taste.music), vibe: list(a.taste.vibe), themes: list(a.taste.themes), food: list(a.taste.food) } } : {}),
    ...(a.media ? { media: { podcasts: list(a.media.podcasts), films: list(a.media.films), tv: list(a.media.tv), books: list(a.media.books) } } : {}),
  };
}

const stop = (s: Stop): Stop => ({ ...s, score: city(s.score), rooms: s.rooms.map(room), openers: s.openers.map(opener), after: s.after.map(spot), ...(s.posters ? { posters: s.posters.map(spot) } : {}) });

/** The control group keeps its ranks and the room scores the comparison prints; the cities' raw affinity goes. */
const guess = ({ cityMean: _c, ...g }: Guess): Guess => ({ ...g, stops: g.stops.map(({ affinity: _a, ...x }) => x) }) as Guess;

/** Any part of a plan (the run streams it in pieces), trimmed the same way. */
export function publicPlan<P extends Partial<Plan>>(p: P): P {
  return {
    ...p,
    ...(p.heat ? { heat: snapHeat(p.heat) } : {}),
    ...(p.cities ? { cities: p.cities.map(city) } : {}),
    ...(p.stops ? { stops: p.stops.map(stop) } : {}),
    ...(p.audience ? { audience: audience(p.audience) } : {}),
    ...(p.guess ? { guess: guess(p.guess) } : {}),
  };
}

export function publicTour(rec: TourRecord): TourRecord {
  return rec.plan ? { ...rec, plan: publicPlan(rec.plan) } : rec;
}
