import "server-only";
import { marketById, type Market } from "../geo/markets";
import { CHAINS } from "../chains";
import { BIG_ROOM_DRAW, BIG_ROOM_TAGS, cityArea, cleanName, DEFAULT_VENUE_TAGS, genresOf, isMember, isRoom, ladderTier, nearCity, openerProblem, orchestraHallFor, placeTagIds, roomLadder, sharesName, venueTier, type LadderRoom } from "./rooms";
import { wikidataRoomsNear } from "../wikidata";
export { cityArea, isRoom, sharesName, venueTier } from "./rooms";
import { describeRequest, qlooGet, recommend, search, type Entity } from "../qloo";
import type { Artist, LogLine, Opener, Room, Spot } from "../types";
import { aliasesOf, placeWords, roomNameMatches } from "./plan";

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
  name: cleanName(e.name),
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
    const genres = artist.genreKeys ?? artist.genres;
    const rooms = r.entities.filter((e) => nearCity(e, m) && isRoom(e, draw) && !orchestraHallFor(e.name, genres)).map(toRoom).slice(0, 14);
    log({ kind: "qloo", text: `Which ${tier.name} in ${m.name} do ${artist.name} fans go to?`, result: rooms.length ? rooms.slice(0, 3).map((x) => `${x.name}${pct(x.affinity)}`).join(", ") : "No rooms of that size came back.", request: describeRequest(r.request), ms });
    // Qloo tags a 200-cap club "concert hall" too, so for a crowd of 3,000 to 9,000 the big rooms are asked for on
    // their own (arenas and amphitheatres) and put first in line to be measured.
    if (draw && draw >= BIG_ROOM_DRAW && !tier.tags.every((t) => BIG_ROOM_TAGS.includes(t))) {
      try {
        const [b, ms2] = await timed(() => recommend({ type: "urn:entity:place", signals: [artist.id], filterLocation: placeQuery(m), near: cityArea(m), tags: BIG_ROOM_TAGS, take: 15 }));
        const big = b.entities.filter((e) => nearCity(e, m) && isRoom(e, draw) && !orchestraHallFor(e.name, genres) && !rooms.some((x) => x.id === e.id)).map(toRoom).slice(0, 6);
        log({ kind: "qloo", text: `Which arenas and amphitheatres in ${m.name} do ${artist.name} fans go to?`, result: big.length ? big.slice(0, 3).map((x) => `${x.name}${pct(x.affinity)}`).join(", ") : "None came back.", request: describeRequest(b.request), ms: ms2 });
        return [...rooms, ...big];
      } catch {
        return rooms;
      }
    }
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
        take: 15,
        extra: { ...extra, "signal.location": `POINT(${m.lon} ${m.lat})` },
      }),
    );
    const headliner = { id: artist.id, name: artist.name, popularity: pop, genres: artist.genreKeys ?? artist.genres };
    const ruledOut: string[] = [];
    const openers: Opener[] = r.entities
      .filter((e) => {
        const why = openerProblem(headliner, { id: e.id, name: e.name, description: e.description, popularity: e.popularity, genres: genresOf(e.tags) });
        if (why && why !== "the headliner") ruledOut.push(`${e.name} (${why})`);
        return !why;
      })
      .slice(0, 5)
      .map((e) => ({ id: e.id, name: cleanName(e.name), image: e.image, affinity: e.affinity, popularity: e.popularity, description: e.description, genres: genresOf(e.tags).slice(0, 4), shared: [] }));
    log({ kind: "qloo", text: `Who could open in ${m.name}, for an audience like ${artist.name}'s?`, result: `${openers.length ? openers.slice(0, 3).map((x) => `${x.name}${pct(x.affinity)}`).join(", ") : "No artists came back."}${ruledOut.length ? `; ruled out ${ruledOut.slice(0, 3).join(", ")}` : ""}`, request: describeRequest(r.request), ms });
    return openers;
  } catch (e) {
    log({ kind: "qloo", text: `Who could open in ${m.name}?`, result: (e as Error).message, failed: true });
    return [];
  }
}

/**
 * A room the agent named, found on Qloo: a place search for the name with the city's name after it (Qloo's /search
 * answers 400 to a POINT for filter.location, measured Oct 26, so the city goes in the query and the distance is
 * checked here), kept only when the match is in the city, is a room by the same rules as Qloo's own list (an
 * orchestra's hall included), and carries the name (plan.ts roomNameMatches: "ACL Live at the Moody Theater" is
 * Qloo's "Austin City Limits Live (ACL Live & 3TEN ACL Live)"). Returns the place as a room, or null. One Qloo call.
 */
export async function findPlace(artist: Artist, name: string, marketId: string, draw?: number): Promise<Room | null> {
  const m = marketById(marketId);
  if (!m) return null;
  const place = placeWords(m);
  const genres = artist.genreKeys ?? artist.genres;
  // The room was named as a room (by the agent or Wikidata) and must carry the name, so a stadium tag alone doesn't
  // rule it out (Qloo files the Unipol Forum as a stadium).
  const ok = (x: Entity, asked: string) => nearCity(x, m) && x.place?.lat !== undefined && isRoom(x, draw, { stadiumOk: true }) && !orchestraHallFor(x.name, genres) && roomNameMatches(asked, x.name, place);
  // The name without the city's own words, then the city ("Alcatraz Milano" is searched as "Alcatraz Milan"); then,
  // for a renamed room, its current name once (Qloo lists the Mediolanum Forum as the Unipol Forum).
  const bare = name.split(/\s+/).filter((w) => !place.includes(w.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase())).join(" ") || name;
  for (const q of [bare, ...aliasesOf(name).slice(0, 1)]) {
    // A failed search throws, so the call sheet can tell "Qloo didn't answer" from "no such room".
    const r = await search(`${q} ${m.name}`, "urn:entity:place", 10);
    const e = r.entities.find((x) => ok(x, name));
    if (e) return { ...toRoom(e), origin: "agent" };
  }
  return null;
}

/**
 * The city's rooms by capacity from Wikidata (P1083 within 30 km, one cached query a market), kept to the ones that
 * fit this crowd (60–250%), closest to it first: for a city whose Qloo rooms can't take the crowd (Qloo's arena
 * query came back empty for Tulsa at 15,000). Each still has to be found on Qloo before it can be booked.
 */
export async function ladderRooms(marketId: string, draw: number): Promise<LadderRoom[]> {
  const m = marketById(marketId);
  if (!m) return [];
  const rows = await wikidataRoomsNear({ lat: m.lat, lon: m.lon }, 30);
  if (!rows) return [];
  return ladderTier(roomLadder(rows, draw), draw).sort((a, b) => Math.abs(Math.log(a.capacity / draw)) - Math.abs(Math.log(b.capacity / draw)));
}

/**
 * The artist's fans' affinity for named places, in one Qloo call (filter.results.entities), so a room the agent
 * named is ranked on the same taste graph as the rooms Qloo listed.
 */
export async function scoreRooms(artist: Artist, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { body } = await qlooGet<{ results?: { entities?: { entity_id: string; query?: { affinity?: number } }[] } }>("/v2/insights", {
    "filter.type": "urn:entity:place",
    "signal.interests.entities": artist.id,
    "filter.results.entities": ids.join(","),
    take: Math.min(50, ids.length),
  });
  for (const e of body.results?.entities ?? []) if (typeof e.query?.affinity === "number") out.set(e.entity_id, e.query.affinity);
  return out;
}

/**
 * "Sounds like" (H10): artists whose audience Qloo matches to this one's and who are at least as well known, so
 * their fans leave a denser heatmap. For an act too new for its own map, the tour is read through two or three
 * of them sent together. A solo member or side project of the artist isn't a comparable.
 */
export async function lookUpSoundsLike(artist: Artist, log: Log, take = 3): Promise<{ id: string; name: string }[]> {
  try {
    const [r, ms] = await timed(() =>
      recommend({
        type: "urn:entity:artist",
        signals: [artist.id],
        exclude: [artist.id],
        take: 15,
        ...(artist.popularity !== undefined ? { extra: { "filter.popularity.min": Math.min(0.99, artist.popularity).toFixed(3) } } : {}),
      }),
    );
    const like = r.entities
      .filter((e) => e.id !== artist.id && !sharesName(artist.name, e.name) && !isMember(artist.name, e))
      .slice(0, take)
      .map((e) => ({ id: e.id, name: cleanName(e.name) }));
    log({ kind: "qloo", text: `Which better-known artists does Qloo match to ${artist.name}'s audience?`, result: like.length ? like.map((x) => x.name).join(", ") : "None came back.", request: describeRequest(r.request), ms });
    return like;
  } catch (e) {
    log({ kind: "qloo", text: `Which better-known artists does Qloo match to ${artist.name}'s audience?`, result: (e as Error).message, failed: true });
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
      .map((e) => ({ id: e.id, name: cleanName(e.name), address: e.place?.address ?? e.disambiguation, affinity: e.affinity, kind: spotKind(placeTagIds(e)), lat: e.place?.lat, lon: e.place?.lon, area: e.place?.area, areaTrait: e.tags.find((t) => t.id.startsWith("urn:tag:neighborhood_characteristic:"))?.name }));
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
