import "server-only";
import { marketById, type Market } from "../geo/markets";
import { CHAINS } from "../chains";
import { describeRequest, recommend, type Entity } from "../qloo";
import type { Artist, LogLine, Opener, Room, Spot } from "../types";

/**
 * The per-city Qloo lookups the agent can call, each logged with its plain question and exact request.
 * Tag URNs come from env so a probe result can change them without a deploy.
 */
export const VENUE_TAGS = (process.env.QLOO_VENUE_TAGS ?? "urn:tag:genre:place:live_music_venue,urn:tag:genre:place:concert_hall").split(",");
export const AFTER_TAGS = (process.env.QLOO_AFTER_TAGS ?? "urn:tag:genre:place:restaurant:live_music_bar,urn:tag:genre:place:restaurant:cocktail_bar,urn:tag:genre:place:restaurant:bar").split(",");
/** Where a street team puts up posters: the record stores, bookshops and cafés these fans already go to. */
export const POSTER_TAGS = (process.env.QLOO_POSTER_TAGS ?? "urn:tag:genre:place:record_store,urn:tag:genre:place:book_store,urn:tag:genre:place:restaurant:coffee_shop").split(",");

/** Places tagged as music venues that aren't rooms a touring band books (Qloo tags chapels and casinos too). */
const NOT_A_ROOM = /church|chapel|cathedral|place_of_worship|museum|casino|hotel|stadium|amusement|school|university|record_store|music_store|clothing_store|book_store|winery/;

export type Log = (line: Omit<LogLine, "at">) => void;

/** The name Qloo's locality matcher resolves best: "Portland, Oregon"-style, not "Portland, OR". */
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
});

/** Rooms in this city whose crowd matches the artist's fans: places tagged as music venues, ranked by Qloo
 *  affinity to the artist. */
export async function lookUpRooms(artist: Artist, marketId: string, log: Log): Promise<Room[]> {
  const m = marketById(marketId);
  if (!m) return [];
  try {
    const [r, ms] = await timed(() => recommend({ type: "urn:entity:place", signals: [artist.id], filterLocation: placeQuery(m), tags: VENUE_TAGS, take: 12 }));
    const rooms = r.entities.filter((e) => !e.place?.isClosed && !e.tags.some((t) => /genre:place|category:place/.test(t.id) && NOT_A_ROOM.test(t.id))).map(toRoom).slice(0, 8);
    log({ kind: "qloo", text: `Which rooms in ${m.name} do ${artist.name} fans go to?`, result: rooms.length ? rooms.slice(0, 3).map((x) => `${x.name}${pct(x.affinity)}`).join(", ") : "No music venues came back.", request: describeRequest(r.request), ms });
    return rooms;
  } catch (e) {
    log({ kind: "qloo", text: `Which rooms in ${m.name} do ${artist.name} fans go to?`, result: (e as Error).message, failed: true });
    return [];
  }
}

/** Openers: artists whose audience matches the headliner's, weighted to this city's taste, and not bigger than
 *  the headliner. */
export async function lookUpOpeners(artist: Artist, marketId: string, log: Log): Promise<Opener[]> {
  const m = marketById(marketId);
  if (!m) return [];
  try {
    const [r, ms] = await timed(() =>
      recommend({
        type: "urn:entity:artist",
        signals: [artist.id],
        signalLocation: placeQuery(m),
        exclude: [artist.id],
        take: 8,
        extra: artist.popularity !== undefined ? { "filter.popularity.max": Math.min(0.999, Math.max(0.3, artist.popularity)).toFixed(3) } : {},
      }),
    );
    const openers: Opener[] = r.entities
      .filter((e) => e.id !== artist.id)
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
 * bookshops and cafés they go to (the poster run). Rooms the tour already uses and music venues are left out.
 */
export async function lookUpSpots(kind: keyof typeof SPOTS, artist: Artist, marketId: string, log: Log, skip: string[] = []): Promise<Spot[]> {
  const m = marketById(marketId);
  if (!m) return [];
  const { tags, ask } = SPOTS[kind];
  try {
    const [r, ms] = await timed(() => recommend({ type: "urn:entity:place", signals: [artist.id], filterLocation: placeQuery(m), tags, exclude: skip.length ? skip : undefined, take: 8 }));
    const spots = r.entities
      .filter((e) => !e.place?.isClosed && !skip.includes(e.id) && !CHAINS.test(e.name) && !e.tags.some((t) => VENUE_TAGS.includes(t.id)))
      .slice(0, 3)
      .map((e) => ({ id: e.id, name: e.name, address: e.place?.address ?? e.disambiguation, affinity: e.affinity, kind: spotKind(e.tags.map((t) => t.id)) }));
    log({ kind: "qloo", text: ask(artist.name, m.name), result: spots.map((x) => x.name).join(", ") || "Nothing came back.", request: describeRequest(r.request), ms });
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
