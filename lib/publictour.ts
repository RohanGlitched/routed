import { createHash } from "node:crypto";
import type { Artist, Audience, CityScore, Guess, Local, LogLine, Named, Opener, Plan, QlooDiff, ReadThrough, Room, Spot, Stop, TourRecord } from "./types";

/**
 * A tour as it leaves the server (M8, Qloo's developer terms): no Qloo ids, image links, raw scores or raw
 * street-level tiles, and none of Qloo's descriptive text; only what the pages draw, which still names the places
 * and artists Qloo returned. Qloo's entity ids become opaque ids (a short hash, the same for one entity on every page and in every
 * streamed piece, so a stop's room and booked-room id still match) and image links go; every score left is rounded
 * to two places; the poster's heatmap and the street maps are snapped to grids finer than their dots can show;
 * cities keep their place on the fan map, not Qloo's raw scores; the call sheet's requests show their shape with
 * the ids masked; Qloo's descriptive text (descriptions, place tags, addresses, websites) stays out too. The
 * stored record is untouched, so the pitches, the re-checks and the MCP tools still read
 * everything. (Before Oct 30 the API still carried Qloo's ids, image links and full-precision affinities.)
 */

/** Grid step for the poster heatmap, in degrees (about 28 km; the poster spreads each tile over ~130 km). */
export const HEAT_STEP = 0.25;
/** Grid step for the day sheet's street map, in degrees (about 250 m; Qloo's tiles are about 150 m). */
export const TILE_STEP = 0.0025;

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

/** A city's street-level tiles on a coarser grid, the strongest per cell, strength to two places. */
export function snapTiles(tiles: Local["tiles"]): Local["tiles"] {
  const cells = new Map<string, [number, number, number]>();
  for (const [la, lo, w] of tiles) {
    const lat = +(Math.round(la / TILE_STEP) * TILE_STEP).toFixed(4), lon = +(Math.round(lo / TILE_STEP) * TILE_STEP).toFixed(4);
    const k = `${lat},${lon}`;
    const cur = cells.get(k);
    if (!cur || w > cur[2]) cells.set(k, [lat, lon, Math.round(w * 100) / 100]);
  }
  return [...cells.values()];
}

/** An opaque id for a Qloo entity id: stable across calls, not Qloo's. */
export const opaque = (id: string) => (id ? `x${createHash("sha256").update(`routed:${id}`).digest("hex").slice(0, 12)}` : id);

const r2 = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 100) / 100);
/** A place's coordinates to four places (about 10 m): enough for the street map, not Qloo's geocode as returned. */
const at4 = <T extends { lat?: number; lon?: number }>(o: T): T => ({ ...o, ...(o.lat !== undefined ? { lat: +o.lat.toFixed(4) } : {}), ...(o.lon !== undefined ? { lon: +o.lon.toFixed(4) } : {}) });
const round = <T extends object>(o: T, keys: (keyof T)[]): T => {
  const out = { ...o };
  for (const k of keys) if (typeof out[k] === "number") (out as Record<keyof T, unknown>)[k] = r2(out[k] as number);
  return out;
};

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** A request as the call sheet shows it: its shape, with Qloo's entity ids masked. */
export const maskRequest = (s: string) => s.replace(UUID, "‹id›");

/** A city by its place on the fan map: no affinity, taste signal or tile count. */
const city = (c: CityScore): CityScore => ({ marketId: c.marketId, name: c.name, label: c.label, lat: c.lat, lon: c.lon, rank: c.rank }) as CityScore;
/** A room as the day sheet prints it: its fan affinity (two places), capacity and place, not Qloo's id, image,
 *  popularity or rating. */
const room = ({ popularity: _p, rating: _r, image: _i, website: _w, address: _ad, tags: _t, ...r }: Room): Room => ({ ...at4(round(r, ["affinity"])), tags: [], id: opaque(r.id) });
const opener = ({ popularity: _p, image: _i, description: _d, ...o }: Opener): Opener => ({ ...round(o, ["affinity"]), id: opaque(o.id) });
const spot = ({ affinity: _a, address: _ad, ...s }: Spot): Spot => ({ ...at4(s), id: opaque(s.id) });
const named = ({ affinity: _a, image: _i, ...n }: Named): Named => ({ ...n, id: opaque(n.id) });
const artist = ({ image: _i, description: _d, ...a }: Artist): Artist => ({ ...round(a, ["popularity"]), id: opaque(a.id) });

function audience(a: Audience): Audience {
  const list = (x?: Named[]) => x?.map(named);
  const ages = Object.fromEntries(Object.entries(a.age).map(([k, v]) => [k, r2(v)])) as Audience["age"];
  return {
    ...a,
    age: ages,
    gender: { male: r2(a.gender.male), female: r2(a.gender.female) },
    trend: a.trend.map((t) => ({ date: t.date, percentile: r2(t.percentile), velocity: r2(t.velocity) })),
    tags: a.tags.map(named),
    brands: a.brands.map(named),
    ...(a.taste ? { taste: { music: list(a.taste.music), vibe: list(a.taste.vibe), themes: list(a.taste.themes), food: list(a.taste.food) } } : {}),
    ...(a.media ? { media: { podcasts: list(a.media.podcasts), films: list(a.media.films), tv: list(a.media.tv), books: list(a.media.books) } } : {}),
  };
}

const local = (l: Local): Local => ({ ...l, tiles: Array.isArray(l.tiles) ? snapTiles(l.tiles) : [], hot: { ...l.hot, lat: +l.hot.lat.toFixed(3), lon: +l.hot.lon.toFixed(3) }, ...(l.roomKm !== undefined ? { roomKm: Math.round(l.roomKm * 10) / 10 } : {}) });

const stop = (s: Stop): Stop => ({
  ...s,
  score: city(s.score),
  rooms: s.rooms.map(room),
  ...(s.roomId ? { roomId: opaque(s.roomId) } : {}),
  openers: s.openers.map(opener),
  ...(s.openerId ? { openerId: opaque(s.openerId) } : {}),
  after: s.after.map(spot),
  ...(s.posters ? { posters: s.posters.map(spot) } : {}),
  ...(s.local ? { local: local(s.local) } : {}),
});

/** The control group keeps its ranks and the room scores the comparison prints (two places); the cities' raw
 *  affinity and Qloo's venue ids go. */
const guess = ({ cityMean: _c, ...g }: Guess): Guess =>
  ({
    ...g,
    roomMean: { routed: r2(g.roomMean.routed), guess: r2(g.roomMean.guess) },
    routedRoomAffinity: Object.fromEntries(Object.entries(g.routedRoomAffinity).map(([k, v]) => [opaque(k), r2(v)])),
    stops: g.stops.map(({ affinity: _a, ...x }) => ({ ...x, ...(x.venueId ? { venueId: opaque(x.venueId) } : {}), ...(x.venueAffinity !== undefined ? { venueAffinity: r2(x.venueAffinity) } : {}) })),
  }) as Guess;

const readThrough = (r: ReadThrough[]) => r.map((x) => ({ ...x, id: opaque(x.id) }));

/** Any part of a plan (the run streams it in pieces), trimmed the same way. */
export function publicPlan<P extends Partial<Plan>>(p: P): P {
  return {
    ...p,
    ...(p.artist ? { artist: artist(p.artist) } : {}),
    ...(p.heat ? { heat: snapHeat(p.heat) } : {}),
    ...(p.cities ? { cities: p.cities.map(city) } : {}),
    ...(p.stops ? { stops: p.stops.map(stop) } : {}),
    ...(p.audience ? { audience: audience(p.audience) } : {}),
    ...(p.guess ? { guess: guess(p.guess) } : {}),
    ...(p.readThrough ? { readThrough: readThrough(p.readThrough) } : {}),
    ...(p.qlooDiff ? { qlooDiff: { ...p.qlooDiff, added: p.qlooDiff.added.map(({ affinity: _a, ...x }) => x) as QlooDiff["added"] } } : {}),
  };
}

/** A call-sheet line as published: the request's ids masked. */
export const publicLine = (l: LogLine): LogLine => (l.request ? { ...l, request: maskRequest(l.request) } : l);

export function publicTour(rec: TourRecord): TourRecord {
  return { ...rec, log: rec.log.map(publicLine), ...(rec.plan ? { plan: publicPlan(rec.plan) } : {}) };
}
