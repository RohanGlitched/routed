import type { Entity } from "../qloo";
import type { Market } from "../geo/markets";
import type { Artist, Room } from "../types";
import { kmBetween } from "../geo/local";
import { fit } from "./evidence";

/**
 * The rules about rooms, openers and artists, kept pure (no Qloo, no server) so they are tested: which kinds of
 * place count as a room for a crowd of this size, which Qloo places aren't rooms at all, which artists can't be
 * the opener, which search result is the artist someone typed, and the order to measure rooms in.
 */

/** Which kinds of place count as a room, by the size of crowd the artist draws. A 300-cap club and a 15,000-cap
 *  arena are both "live music venues" to Qloo; the tier picks the tags, and the pool is measured afterwards. */
export const VENUE_TIERS: { max: number; tags: string[]; name: string }[] = [
  { max: 700, name: "clubs and halls", tags: ["urn:tag:genre:place:live_music_venue", "urn:tag:genre:place:concert_hall", "urn:tag:genre:place:rock_music_club", "urn:tag:genre:place:musical_club"] },
  { max: 3000, name: "halls, ballrooms and theatres", tags: ["urn:tag:genre:place:concert_hall", "urn:tag:genre:place:live_music_venue", "urn:tag:genre:place:ballroom", "urn:tag:genre:place:performing_arts_theater"] },
  { max: 9000, name: "theatres, amphitheatres and arenas", tags: ["urn:tag:genre:place:concert_hall", "urn:tag:genre:place:performing_arts_theater", "urn:tag:genre:place:amphitheater", "urn:tag:genre:place:arena"] },
  { max: Infinity, name: "arenas, amphitheatres and stadiums", tags: ["urn:tag:genre:place:arena", "urn:tag:genre:place:amphitheater", "urn:tag:genre:place:stadium", "urn:tag:genre:place:concert_hall"] },
];
export const DEFAULT_VENUE_TAGS = ["urn:tag:genre:place:live_music_venue", "urn:tag:genre:place:concert_hall", "urn:tag:genre:place:ballroom", "urn:tag:genre:place:performing_arts_theater"];

export function venueTier(draw?: number, defaults = DEFAULT_VENUE_TAGS) {
  return draw ? VENUE_TIERS.find((t) => draw <= t.max)! : { max: 0, name: "rooms", tags: defaults };
}

/** Places tagged as venues that aren't rooms a touring band books (Qloo tags chapels, museums and ballparks too). */
const NOT_A_ROOM_TAG = /church|chapel|cathedral|place_of_worship|museum|casino|hotel|amusement|school|university|record_store|music_store|clothing_store|book_store|winery|baseball|football|soccer|hockey|golf|video_arcade|bowling|skatepark|convention_center|brewery|coffee_shop|gift_shop$|recording_studio|cafe$/;
/** Fairs, racetracks and the like carry a venue tag because concerts happen there once a year. */
const NOT_A_ROOM_NAME = /\b(fair|fairgrounds?|speedway|raceway|racetrack|motor|expo|convention|zoo|aquarium|casino|church|cabaret|gentlemen|strip|resort|hall of fame|museum|brewing|brewery|golf|country club|farm|vineyard|winery)\b/i;
/** For a crowd of 3,000 or more a bar, pub or restaurant isn't the room, however the fans love it. */
const BAR_TAG = /restaurant|\bbar$|live_music_bar|pub$|night_club|cocktail/;
const BIG_ROOM_TAG = /concert_hall|amphitheater|arena|stadium|performing_arts_theater|ballroom/;

export const placeTagIds = (e: Pick<Entity, "tags">) => e.tags.filter((t) => /genre:place|category:place/.test(t.id)).map((t) => t.id);

/** Whether a Qloo place is a room this crowd could be booked into, by its tags and name. */
export function isRoom(e: Pick<Entity, "name" | "tags" | "place">, draw?: number): boolean {
  if (e.place?.isClosed) return false;
  const ids = placeTagIds(e);
  if (ids.some((id) => NOT_A_ROOM_TAG.test(id)) && !ids.some((id) => BIG_ROOM_TAG.test(id) && !/stadium/.test(id))) return false;
  if (NOT_A_ROOM_NAME.test(e.name)) return false;
  if (draw && draw >= 3000 && ids.some((id) => BAR_TAG.test(id)) && !ids.some((id) => BIG_ROOM_TAG.test(id))) return false;
  if (!(draw && draw >= 9000) && ids.some((id) => /stadium/.test(id))) return false;
  return true;
}

/** The city as a point and a radius that grows with the metro: 18 km for a town, 40 km for a metropolis. */
export function cityArea(m: Pick<Market, "lat" | "lon" | "pop">): { lat: number; lon: number; radiusM: number } {
  const radiusKm = m.pop >= 3_000_000 ? 40 : m.pop >= 1_000_000 ? 30 : m.pop >= 300_000 ? 22 : 18;
  return { lat: m.lat, lon: m.lon, radiusM: radiusKm * 1000 };
}

/** A place Qloo returned that isn't near the city at all (a name collision slipped through) is dropped. */
export const nearCity = (e: Pick<Entity, "place">, m: Pick<Market, "lat" | "lon" | "pop">) =>
  e.place?.lat === undefined || e.place?.lon === undefined || kmBetween({ lat: e.place.lat, lon: e.place.lon }, m) <= cityArea(m).radiusM / 1000 + 15;

/** A word of the headliner's name in an opener's name (a solo member, a side project, "X Band") rules it out. */
export function sharesName(headliner: string, opener: string): boolean {
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !["band", "the", "and", "with", "from", "orchestra", "brothers", "sisters"].includes(w));
  const h = new Set(words(headliner));
  return words(opener).some((w) => h.has(w));
}

/** The order to measure rooms in: for a big crowd the best-known rooms first (popularity is a size proxy), for a
 *  small one the best-matched; rooms already known to miss the crowd go last. */
export function candidatesBySize(rooms: Room[], draw: number): Room[] {
  const misses = (r: Room) => Number(fit(r, draw) !== "unknown" && fit(r, draw) !== "fits");
  return [...rooms].sort((a, b) => misses(a) - misses(b) || (draw >= 1000 ? (b.popularity ?? 0) - (a.popularity ?? 0) : (b.affinity ?? 0) - (a.affinity ?? 0)));
}

const foldName = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Which search result is the artist someone typed: an exact name match wins over Qloo's first result (typing
 * "Wednesday" must not land on "Wednesday Campanella"); otherwise Qloo's best match. The other plausible
 * results are kept so the tour book can offer them (the kit's "needs_input" idea): a result counts as plausible
 * when its name contains the typed name, or the typed name contains it.
 */
export function pickArtist<T extends Pick<Artist, "name" | "popularity">>(typed: string, found: T[]): { pick: T | undefined; others: T[] } {
  if (!found.length) return { pick: undefined, others: [] };
  const want = foldName(typed);
  const exact = found.find((e) => foldName(e.name) === want);
  const pick = exact ?? found[0]!;
  const others = found.filter((e) => e !== pick && (foldName(e.name).includes(want) || want.includes(foldName(e.name)))).slice(0, 3);
  return { pick, others };
}
