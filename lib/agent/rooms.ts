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
  // A crowd of 10,000+ fills an arena or an amphitheatre; concert halls and theatres only brought back 1,000-cap rooms.
  { max: 29_999, name: "arenas and amphitheatres", tags: ["urn:tag:genre:place:arena", "urn:tag:genre:place:amphitheater"] },
  { max: Infinity, name: "arenas, amphitheatres and stadiums", tags: ["urn:tag:genre:place:arena", "urn:tag:genre:place:amphitheater", "urn:tag:genre:place:stadium", "urn:tag:genre:place:concert_hall"] },
];
/** From this draw up, arenas and amphitheatres are looked up on their own as well. */
export const BIG_ROOM_DRAW = 3000;
export const BIG_ROOM_TAGS = ["urn:tag:genre:place:arena", "urn:tag:genre:place:amphitheater"];
/** A café, bar, pub or club by name is not the room for a crowd of 3,000 (Olympic Café came back for 8,000). */
const SMALL_NAME = /\b(caf[eé]|bar|pub|tavern|lounge|club|jazz|kneipe|bistro|brasserie|taproom|saloon)(?![a-z])/i;
/** An orchestra's own hall: booked for orchestras, not for a rock, pop or hip-hop tour. */
const ORCHESTRA_HALL = /\b(symphony|philharmoni[ce]|orchestra hall|walt disney concert hall|benaroya hall|meyerhoff|davies symphony|severance hall|carnegie hall|heinz hall|boettcher|kimmel center|segerstrom concert hall|roy thomson hall|jack singer|royal festival hall|elbphilharmonie|concertgebouw)\b/i;
/** Genres whose acts do play orchestra halls. */
const HALL_GENRES = /classical|orchestral|chamber|choral|opera|jazz|neo ?classical|ambient|contemporary classical/;

/** Whether a room is an orchestra's home hall that this act wouldn't be booked into. */
export function orchestraHallFor(name: string, genres: string[]): boolean {
  return ORCHESTRA_HALL.test(name) && !genres.some((g) => HALL_GENRES.test(g.toLowerCase()));
}

/** A pub, bar or tavern by name is not the room for 1,000 either (O'Briens Pub came back for 2,500). */
const BAR_NAME = /\b(caf[eé]|bar|pub|tavern|lounge|bistro|brasserie|taproom|saloon|kneipe|food carts?|craft beer|beer garden|biergarten|backyard)(?![a-z])/i;
/** Below this draw a stadium is never the room, whatever its tags (Nissan Stadium once came back for 15,000). */
export const STADIUM_MIN_DRAW = 30_000;
/** A room that holds this share of the crowd or more, but less than a one-night fit, is booked for two nights. */
export const TWO_NIGHT_MIN = 0.3;
export const DEFAULT_VENUE_TAGS = ["urn:tag:genre:place:live_music_venue", "urn:tag:genre:place:concert_hall", "urn:tag:genre:place:ballroom", "urn:tag:genre:place:performing_arts_theater"];

export function venueTier(draw?: number, defaults = DEFAULT_VENUE_TAGS) {
  return draw ? VENUE_TIERS.find((t) => draw <= t.max)! : { max: 0, name: "rooms", tags: defaults };
}

/** Places tagged as venues that aren't rooms a touring band books (Qloo tags chapels, museums and ballparks too). */
const NOT_A_ROOM_TAG = /church|chapel|cathedral|place_of_worship|museum|casino|hotel|amusement|school|university|record_store|music_store|clothing_store|book_store|winery|baseball|football|soccer|hockey|golf|video_arcade|bowling|skatepark|convention_center|brewery|coffee_shop|gift_shop$|recording_studio|cafe$/;
/** Fairs, racetracks and the like carry a venue tag because concerts happen there once a year. */
const NOT_A_ROOM_NAME = /\b(fair|fairgrounds?|speedway|raceway|racetrack|motor|expo|convention|zoo|aquarium|casino|church|cabaret|gentlemen|strip|resort|hall of fame|museum|brewing|brewery|golf|country club|farm|vineyard|winery)\b/i;
/** Places that host the odd performance but aren't where a touring band plays (Westbeth Artists Housing). */
const NOT_A_ROOM_EVER = /\b(housing|apartments?|residences?|lofts|condos?|hostel)\b/i;
/** A gallery or an art centre can be a 200-cap room; for a crowd of 700 or more it isn't. */
const SMALL_ART_ROOM = /\b(gallery|galerie|art center|art centre|arts centre|art museum|artist run)\b/i;
/** For a crowd of 3,000 or more a bar, pub or restaurant isn't the room, however the fans love it. */
const BAR_TAG = /restaurant|\bbar$|live_music_bar|pub$|night_club|cocktail/;
const BIG_ROOM_TAG = /concert_hall|amphitheater|arena|stadium|performing_arts_theater|ballroom/;

export const placeTagIds = (e: Pick<Entity, "tags">) => e.tags.filter((t) => /genre:place|category:place/.test(t.id)).map((t) => t.id);

/** Whether a Qloo place is a room this crowd could be booked into, by its tags and name. */
export function isRoom(e: Pick<Entity, "name" | "tags" | "place">, draw?: number): boolean {
  if (e.place?.isClosed) return false;
  const ids = placeTagIds(e);
  if (ids.some((id) => NOT_A_ROOM_TAG.test(id)) && !ids.some((id) => BIG_ROOM_TAG.test(id) && !/stadium/.test(id))) return false;
  if (!roomNameOk(e.name, draw)) return false;
  if (draw && draw >= 3000 && ids.some((id) => BAR_TAG.test(id)) && !ids.some((id) => BIG_ROOM_TAG.test(id))) return false;
  if (!(draw && draw >= STADIUM_MIN_DRAW) && ids.some((id) => /stadium/.test(id))) return false;
  return true;
}

/** The rules a room's name alone can settle (so they apply to stored tours too): fairs, housing, galleries for
 *  big crowds, bars and cafés, stadiums. */
export function roomNameOk(name: string, draw?: number): boolean {
  if (NOT_A_ROOM_NAME.test(name) || NOT_A_ROOM_EVER.test(name)) return false;
  if (draw && draw >= 700 && SMALL_ART_ROOM.test(name) && !/performing arts/i.test(name)) return false;
  if (draw && draw >= BIG_ROOM_DRAW && SMALL_NAME.test(name)) return false;
  if (draw && draw >= 1000 && BAR_NAME.test(name)) return false;
  if (!(draw && draw >= STADIUM_MIN_DRAW) && /\b(stadium|stadion|ballpark|field)\b/i.test(name)) return false;
  return true;
}

/** A venue name as a poster prints it: no stray question marks, quotes or doubled spaces from the listing. */
export function cleanName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’\s]+|["'“”‘’\s?¿]+$/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

/* ───────────────────────── rooms by size ───────────────────────── */

/** Two nights cover the crowd: the room holds 30–60% of it (one night would turn half the fans away). */
export function twoNights(r: Room, draw?: number): boolean {
  if (!draw || !r.capacity) return false;
  const share = r.capacity.value / draw;
  return share >= TWO_NIGHT_MIN && share < 0.6;
}

/** A room up to this many times the crowd can be booked in a reduced configuration (balcony closed, half house). */
export const REDUCED_MAX = 4;

/** Too big, but a reduced configuration covers it: the pitch asks for one. */
export function reducedHouse(r: Room, draw?: number): boolean {
  return Boolean(draw && r.capacity && r.capacity.value > draw * 2.5 && r.capacity.value <= draw * REDUCED_MAX);
}

/**
 * How good a room is for this crowd, lower is better: 0 a known fit (60–250% of the draw, one night); 1 a known
 * two-night stand (30–60%); 1.5 a known room up to four times the crowd, in a reduced configuration; then a room
 * whose capacity couldn't be found (2 for a crowd under 3,000, where clubs are rarely on Wikidata; 2.5 from 3,000
 * up, where an unmeasured room is nearly always a small one); then rooms known to miss by how far they miss.
 */
export function roomGrade(r: Room, draw?: number): number {
  if (!draw) return 0;
  const f = fit(r, draw);
  if (f === "fits") return 0;
  if (twoNights(r, draw)) return 1;
  if (reducedHouse(r, draw)) return 1.5;
  if (f === "unknown") return draw >= BIG_ROOM_DRAW ? 2.5 : 2;
  return 3 + Math.abs(Math.log(r.capacity!.value / draw));
}

/** The room to book: the best grade; among equals the agent's choice, then Qloo's order (fan affinity). */
export function chooseRoom(rooms: Room[], wanted: string | undefined, draw?: number): Room | undefined {
  if (!rooms.length) return undefined;
  const order = [...rooms].sort((a, b) => roomGrade(a, draw) - roomGrade(b, draw) || Number(b.id === wanted) - Number(a.id === wanted) || rooms.indexOf(a) - rooms.indexOf(b));
  return order[0];
}

/* ───────────────────────── openers ───────────────────────── */

/** Nationalities and catch-alls that Qloo files as genres; sharing one says nothing about a bill. */
const NOT_A_GENRE = /^(usa|us|american|irish|british|english|scottish|welsh|uk|australian|canadian|swedish|german|french|norwegian|danish|dutch|spanish|italian|mexican|singer (&|and) songwriter|singer songwriter|acoustic|experimental|instrumental|vocal|vocals|female vocalists|male vocalists|seen live)$/;

export const foldGenre = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();

/** The genres in a Qloo tag list (genre and subgenre tags), folded so "Post-Punk" meets "Post Punk". */
export function genresOf(tags: { id: string; name: string; type?: string }[]): string[] {
  const out = new Set<string>();
  for (const t of tags) if (/(^|:)(sub)?genre(:|$)/.test(t.type ?? "") || /:(sub)?genre:/.test(t.id)) {
    const g = foldGenre(t.name);
    if (g && !NOT_A_GENRE.test(g) && !/:place:/.test(t.id)) out.add(g);
  }
  return [...out];
}

/** Umbrella genres: sharing one ("rock", "indie rock") puts an Americana act under a post-punk band, so it takes two. */
const BROAD = /^(rock|pop|alternative|alternative rock|indie|indie rock|indie pop|pop rock|folk|electronic|dance|soul|punk|metal|rap|hip hop|country|blues|jazz|world|r&b|rnb)$/;

/**
 * Whether two acts share a genre: one specific genre in common (post-punk, Americana, metalcore), or two
 * umbrella ones. When either side has no genres on Qloo, nothing can be said, so it passes.
 */
export function sharesGenre(headliner: string[], opener: string[]): boolean {
  const h = new Set(headliner.map(foldGenre).filter((g) => g && !NOT_A_GENRE.test(g)));
  const o = [...new Set(opener.map(foldGenre).filter((g) => g && !NOT_A_GENRE.test(g)))];
  if (!h.size || !o.length) return true;
  const shared = o.filter((g) => h.has(g));
  return shared.some((g) => !BROAD.test(g)) || shared.length >= 2;
}

/** "best known as the lead guitarist of the heavy metal band Metallica": a member of another band, not a support act. */
const SIDE_MEMBER = [
  /\bbest known\b[^.]{0,80}?\b(of|for|in|with)\b[^.]{0,60}?\b(band|group|duo|trio|quartet|supergroup|collective)\b/i,
  /\b(frontman|frontwoman|front man|front woman)\s+(of|for)\b/i,
  /\b(is|was)\s+(a|an|the)\s+(former\s+|founding\s+|current\s+|longtime\s+)?(member|co-?founder)\s+of\b/i,
  /\blead\s+(vocalist|singer|guitarist)\b[^.]{0,30}?\b(of|for|in)\b[^.]{0,60}?\b(band|group)\b/i,
];

/** A band's own description names its singer ("fronted by vocalist…"); only a person who is in another band counts. */
const IS_A_BAND = /^[^.]{0,120}?\b(is|are|was|were)\s+(an?|the)\s+([\w&'-]+,?\s+){0,5}(band|group|duo|trio|quartet|quintet|collective|ensemble|project|supergroup)\b/i;

export function isSideMember(description?: string): boolean {
  if (!description) return false;
  if (IS_A_BAND.test(description)) return false;
  return SIDE_MEMBER.some((re) => re.test(description));
}

/**
 * Why an artist Qloo suggests can't open for this headliner, or null when they can: the headliner themselves,
 * a shared name word (a solo member or side project), a member of the headliner or of another band (Grian
 * Chatten fronts Fontaines D.C.; Kirk Hammett plays in Metallica), not clearly smaller than the headliner, or no
 * genre in common (bluegrass under post-punk, country under disco-funk).
 */
export function openerProblem(headliner: { id?: string; name: string; popularity?: number; genres: string[] }, cand: { id?: string; name: string; description?: string; popularity?: number; genres: string[] }): string | null {
  if (cand.id && cand.id === headliner.id) return "the headliner";
  if (foldName(cand.name) === foldName(headliner.name)) return "the headliner";
  if (sharesName(headliner.name, cand.name)) return "shares the headliner's name";
  if (isMember(headliner.name, cand)) return `a member of ${headliner.name}`;
  if (isSideMember(cand.description)) return "a member of another band";
  if (headliner.popularity !== undefined && cand.popularity !== undefined && cand.popularity >= headliner.popularity) return "not smaller than the headliner";
  if (!sharesGenre(headliner.genres, cand.genres)) return "no genre in common";
  return null;
}

/**
 * One support act for the whole run (it travels with the tour, as on a real tour): the opener the agent picked
 * most often; ties go to the one that turned up in the most cities' lookups, then to the higher summed affinity.
 * Returns undefined when no city has an opener.
 */
export function pickSupport<O extends { id: string; affinity?: number }>(stops: { openers: O[]; openerId?: string }[]): O | undefined {
  const tally = new Map<string, { o: O; votes: number; seen: number; aff: number }>();
  for (const s of stops) {
    for (const o of s.openers) {
      const t = tally.get(o.id) ?? { o, votes: 0, seen: 0, aff: 0 };
      t.seen++;
      t.aff += o.affinity ?? 0;
      tally.set(o.id, t);
    }
    if (s.openerId) {
      const t = tally.get(s.openerId);
      if (t) t.votes++;
    }
  }
  return [...tally.values()].sort((a, b) => b.votes - a.votes || b.seen - a.seen || b.aff - a.aff)[0]?.o;
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

/** Qloo's description names the band a solo act fronts ("Irish singer, frontman of Fontaines D.C."): not an opener. */
export function isMember(headliner: string, opener: { name: string; description?: string }): boolean {
  const d = (opener.description ?? "").toLowerCase();
  const h = headliner.toLowerCase().replace(/^the\s+/, "");
  return h.length > 3 && d.includes(h) && /\b(member|frontman|frontwoman|front man|singer of|vocalist of|guitarist of|drummer of|bassist of|founder of|leader of|lead singer|side project|solo project|formerly of|best known as)\b/.test(d);
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
