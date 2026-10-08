import "server-only";
import { marketById, type Market } from "../geo/markets";
import { CHAINS } from "../chains";
import { cityArea, DEFAULT_VENUE_TAGS, isMember, isRoom, nearCity, placeTagIds, sharesName, venueTier } from "./rooms";
export { cityArea, isRoom, sharesName, venueTier } from "./rooms";
import { describeRequest, recommend, type Entity } from "../qloo";
import type { Artist, LogLine, Opener, Room, Spot } from "../types";

/**
 * The per-city Qloo lookups the agent can call, each logged with its plain question and exact request. Every
 * lookup is placed by coordinates (a point and a radius sized to the city), never by a bare name: "London" is in
 * Ontario too, and Qloo resolves "Reading" to Pennsylvania as readily as Berkshire.
 */

export const VENUE_TAGS = (process.env.QLOO_VENUE_TAGS ?? DEFAULT_VENUE_TAGS.join(",")).split(",");
export const AFTER_TAGS = (process.env.QLOO_AFTER_TAGS ?? "urn:tag:genre:place:restaurant:live_music_bar,urn:tag:genre:place:restaurant:cocktail_bar,urn:tag:genre:place:restaurant:bar").split(",");
/** Where a street team puts up posters: the record stores, bookshops and cafés these fans already go to. */
export const POSTER_TAGS = (process.env.QLOO_POSTER_TAGS ?? "urn:tag:genre:place:record_store,urn:tag:genre:place:book_store,urn:tag:genre:place:restaurant:coffee_shop").split(",");

/** Aftershow spots a crew shouldn't be sent to by a booking agent. */
const NOT_AN_AFTERSHOW = /\b(cabaret|gentlemen|strip|adult|paint|pottery|escape room|axe|bowling|arcade|kids|family fun|church)\b/i;

export type Log = (line: Omit<LogLine, "at">) => void;

/** The name Qloo's locality matcher resolves best, for the call sheet: "Portland, OR"-style in the US. */
export function placeQuery(m: Market): string {
  if (m.cc === "US") return `${m.ascii}, ${m.state}`;
  return `${m.ascii}`;
}

const pct = (v?: number) => (v === undefined ? "" : ` ${Math.round(v * 100)}`);

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const r = await fn();
  return [r, Date.now() - t];
}

const toRoom = (e: Entity): Room => ({
  id: e.id,
  name: e.name,
  address: e.place?.address ?? e.disambiguation,
  lat: e.place?.lat,
  lon: e.place?.lon,
  affinity: e.affinity,
  popularity: e.popularity,
  rating: e.place?.rating,
  website: e.place?.website,
  image: e.image,
  tags: e.tags.map((t) => t.name).slice(0, 6),
  area: e.place?.area,
});


/**
 * Rooms in this city whose crowd matches the artist's fans: places tagged for the crowd's size tier, inside the
 * city's radius, ranked by Qloo affinity to the artist. Up to 12 are kept so a capacity check has rooms to fall
 * back on when the first choice is too small.
 */
export async function lookUpRooms(artist: Artist, marketId: string, log: Log, draw?: number): Promise<Room[]> {
  const m = marketById(marketId);
  if (!m) return [];
  const tier = venueTier(draw);
  try {
    const [r, ms] = await timed(() => recommend({ type: "urn:entity:place", signals: [artist.id], filterLocation: placeQuery(m), near: cityArea(m), tags: tier.tags, take: 25 }));
    const rooms = r.entities.filter((e) => nearCity(e, m) && isRoom(e, draw)).map(toRoom).slice(0, 14);
    log({ kind: "qloo", text: `Which ${tier.name} in ${m.name} do ${artist.name} fans go to?`, result: rooms.length ? rooms.slice(0, 3).map((x) => `${x.name}${pct(x.affinity)}`).join(", ") : "No rooms of that size came back.", request: describeRequest(r.request), ms });
    return rooms;
  } catch (e) {
    log({ kind: "qloo", text: `Which ${tier.name} in ${m.name} do ${artist.name} fans go to?`, result: (e as Error).message, failed: true });
    return [];
  }
}


/**
 * Openers: artists whose audience matches the headliner's, weighted to this city's taste, clearly smaller than
 * the headliner (a popularity margin, so a co-headliner or the band's own singer doesn't come back as support)
 * and not unknown either.
 */
export async function lookUpOpeners(artist: Artist, marketId: string, log: Log): Promise<Opener[]> {
  const m = marketById(marketId);
  if (!m) return [];
  const pop = artist.popularity;
  const extra: Record<string, string> = {};
  if (pop !== undefined) {
    extra["filter.popularity.max"] = Math.min(0.999, Math.max(0.25, pop - 0.05)).toFixed(3);
    extra["filter.popularity.min"] = Math.max(0, pop - 0.45).toFixed(3);
  }
  try {
    const [r, ms] = await timed(() =>
      recommend({
        type: "urn:entity:artist",
        signals: [artist.id],
        signalLocation: placeQuery(m),
        exclude: [artist.id],
        take: 10,
        extra: { ...extra, "signal.location": `POINT(${m.lon} ${m.lat})` },
      }),
    );
    const openers: Opener[] = r.entities
      .filter((e) => e.id !== artist.id && !sharesName(artist.name, e.name) && !isMember(artist.name, e) && (pop === undefined || e.popularity === undefined || e.popularity < pop))
      .slice(0, 5)
      .map((e) => ({ id: e.id, name: e.name, image: e.image, affinity: e.affinity, popularity: e.popularity, description: e.description, shared: [] }));
    log({ kind: "qloo", text: `Who could open in ${m.name}, for an audience like ${artist.name}'s?`, result: openers.length ? openers.slice(0, 3).map((x) => `${x.name}${pct(x.affinity)}`).join(", ") : "No artists came back.", request: describeRequest(r.request), ms });
    return openers;
  } catch (e) {
    log({ kind: "qloo", text: `Who could open in ${m.name}?`, result: (e as Error).message, failed: true });
    return [];
  }
}

const SPOTS = {
  after: { tags: AFTER_TAGS, ask: (a: string, c: string) => `Where do ${a} fans go out in ${c}?` },
  posters: { tags: POSTER_TAGS, ask: (a: string, c: string) => `Where in ${c} would ${a} fans see a poster?` },
} as const;

/**
 * Cross-domain lookups for the advance: the bars these fans go to after a show (aftershow) and the record stores,
 * bookshops and cafés they go to (the poster run), anchored on the fans' hottest tile when the city has one.
 * Rooms the tour already uses, music venues and chains are left out.
 */
export async function lookUpSpots(kind: keyof typeof SPOTS, artist: Artist, marketId: string, log: Log, skip: string[] = [], near?: { lat: number; lon: number }): Promise<Spot[]> {
  const m = marketById(marketId);
  if (!m) return [];
  const { tags, ask } = SPOTS[kind];
  const question = near ? `${ask(artist.name, m.name).replace(/\?$/, "")}, close to where they over-index most?` : ask(artist.name, m.name);
  try {
    const [r, ms] = await timed(() => recommend({ type: "urn:entity:place", signals: [artist.id], filterLocation: placeQuery(m), near: near ? { ...near, radiusM: 2500 } : cityArea(m), tags, exclude: skip.length ? skip : undefined, take: 8 }));
    const spots = r.entities
      .filter((e) => !e.place?.isClosed && nearCity(e, m) && !skip.includes(e.id) && !CHAINS.test(e.name) && !NOT_AN_AFTERSHOW.test(e.name) && !placeTagIds(e).some((id) => VENUE_TAGS.includes(id) || /live_music_venue|concert_hall/.test(id)))
      .slice(0, 3)
      .map((e) => ({ id: e.id, name: e.name, address: e.place?.address ?? e.disambiguation, affinity: e.affinity, kind: spotKind(placeTagIds(e)), lat: e.place?.lat, lon: e.place?.lon, area: e.place?.area, areaTrait: e.tags.find((t) => t.id.startsWith("urn:tag:neighborhood_characteristic:"))?.name }));
    log({ kind: "qloo", text: question, result: spots.map((x) => x.name).join(", ") || "Nothing came back.", request: describeRequest(r.request), ms });
    return spots;
  } catch (e) {
    log({ kind: "qloo", text: ask(artist.name, m.name), result: (e as Error).message, failed: true });
    return [];
  }
}

/** "Record store", "Bookshop", "Café", "Cocktail bar"… from the place's tags, for the day sheet. */
function spotKind(ids: string[]): string | undefined {
  const has = (t: string) => ids.some((x) => x.endsWith(t));
  if (has(":record_store")) return "Record store";
  if (has(":book_store")) return "Bookshop";
  if (has(":coffee_shop") || has(":cafe")) return "Café";
  if (has(":live_music_bar")) return "Live music bar";
  if (has(":cocktail_bar")) return "Cocktail bar";
  if (has(":wine_bar")) return "Wine bar";
  if (has(":bar")) return "Bar";
  return undefined;
}
