import type { Entity } from "../qloo";
import type { Market } from "../geo/markets";
import type { Artist, Room } from "../types";
import { kmBetween } from "../geo/local";
import { fit, SNUG, snugFit } from "./evidence";
import { sameVenue } from "./capacity";

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
const ORCHESTRA_HALL = /\b(symphony|philharmoni[ce]|orchestra hall|walt disney concert hall|benaroya hall|abravanel hall|meyerhoff|davies symphony|severance hall|carnegie hall|heinz hall|boettcher|kimmel center|segerstrom concert hall|roy thomson hall|jack singer|royal festival hall|elbphilharmonie|concertgebouw)\b/i;
/** Genres whose acts do play orchestra halls. */
const HALL_GENRES = /classical|orchestral|chamber|choral|opera|jazz|neo ?classical|ambient|contemporary classical/;

/**
 * Whether a room is an orchestra's home hall that this act wouldn't be booked into. One jazz-flavoured tag among an
 * americana act's genres doesn't open the symphony's hall (Sierra Ferrell got Abravanel Hall, Oct 26): at least
 * half the act's genres must be ones that play there.
 */
export function orchestraHallFor(name: string, genres: string[]): boolean {
  if (!ORCHESTRA_HALL.test(name)) return false;
  const hall = genres.filter((g) => HALL_GENRES.test(g.toLowerCase())).length;
  return !genres.length || hall * 2 < genres.length;
}

/** A pub, bar or tavern by name is not the room for 1,000 either (O'Briens Pub came back for 2,500). */
const BAR_NAME = /\b(caf[eé]|bar|pub|tavern|lounge|bistro|brasserie|taproom|saloon|kneipe|food carts?|craft beer|beer garden|biergarten|backyard)(?![a-z])/i;
/** Below this draw a stadium is never the room, whatever its tags (Nissan Stadium once came back for 15,000). */
export const STADIUM_MIN_DRAW = 30_000;
/** A room that holds this share of the crowd or more, but less than a one-night fit, is booked for two nights: from
 *  half the crowd up, so the two nights together always hold it (at 0.3, Tower Theatre's 460 was booked twice for
 *  1,500 and the day sheet said two nights "cover" 920). */
export const TWO_NIGHT_MIN = 0.5;
/** A measured room from this share of the crowd up is a better booking than a room nobody could measure. */
export const SHORT_MIN = 0.4;
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
/** For a crowd of 1,000 or more a bar, pub or restaurant isn't the room, however the fans love it (the Timbre Room,
 *  tagged a bar, came back for 1,500). */
const BAR_TAG = /restaurant|\bbar$|live_music_bar|pub$|night_club|cocktail/;
export const BAR_TAG_DRAW = 1000;
/** Parks, playgrounds and trails carry a venue tag for the odd summer concert (Route 66 Park, with its ponds and
 *  swings, came back for 15,000): by a tag, or by a name that ends in "Park" or "Green". A park's own stage keeps
 *  its place ("Red Rocks Park and Amphitheatre", "Central Park SummerStage", "Prospect Park Bandshell"). */
// Tags only a park carries: "Park views" or "Free parking" don't count, ponds and swings do.
const PARK_TAG = /\b(playgrounds?|ponds?|swings?|skate ?parks?|hikes|hiking trails?|kid friendly (hikes|parks?|playgrounds?)|splash pads?|dog parks?|green ?spaces?|nature (reserve|preserve|area)|campgrounds?|picnic (areas?|shelters?|tables?))\b|:(park|playground|nature_reserve|hiking_area|dog_park)$/i;
const PARK_NAME = /\b(park|green|playground|commons|trailhead|nature (reserve|preserve|center))$/i;
// A palace or a dome in a park is the building, not the park (Alexandra Palace carries its park's tags).
const PARK_STAGE = /amphithea|pavilion|band ?shell|summerstage|stage|bowl|arena|theat|hall|auditorium|ballroom|music|club|coliseum|palace|dome/i;

/** Whether a place is a park, playground or trail (by its name or any of its tags), not a stage in one. Takes Qloo
 *  tags ({ id, name }) or a stored room's tag names. */
export function isPark(name: string, tags: ({ id?: string; name?: string } | string)[] = []): boolean {
  if (PARK_STAGE.test(name)) return false;
  if (PARK_NAME.test(name.trim())) return true;
  return tags.some((t) => (typeof t === "string" ? PARK_TAG.test(t) : PARK_TAG.test(t.name ?? "") || PARK_TAG.test(t.id ?? "")));
}
const BIG_ROOM_TAG = /concert_hall|amphitheater|arena|stadium|performing_arts_theater|ballroom/;
/** Tags that make a place a music room whatever else it is: Qloo files every arena as a stadium too (BOK Center,
 *  Bridgestone Arena, Ball Arena, Paycom Center: measured Oct 26). */
const VENUE_TAG = /:(arena|concert_hall|amphitheater|live_music_venue|performing_arts_theater|ballroom)$/;

export const placeTagIds = (e: Pick<Entity, "tags">) => e.tags.filter((t) => /genre:place|category:place/.test(t.id)).map((t) => t.id);

/** Whether a Qloo place is a room this crowd could be booked into, by its tags and name. */
export function isRoom(e: Pick<Entity, "name" | "tags" | "place">, draw?: number, opts: { stadiumOk?: boolean } = {}): boolean {
  if (e.place?.isClosed) return false;
  const ids = placeTagIds(e);
  if (ids.some((id) => NOT_A_ROOM_TAG.test(id)) && !ids.some((id) => BIG_ROOM_TAG.test(id) && !/stadium/.test(id))) return false;
  if (!roomNameOk(e.name, draw)) return false;
  const venue = ids.some((id) => VENUE_TAG.test(id));
  if (isPark(e.name, e.tags)) return false;
  if (draw && draw >= BAR_TAG_DRAW && ids.some((id) => BAR_TAG.test(id)) && !ids.some((id) => BIG_ROOM_TAG.test(id))) return false;
  // A stadium below a stadium crowd, unless it is also an arena or a concert venue (an arena is a stadium to Qloo).
  if (!(draw && draw >= STADIUM_MIN_DRAW) && ids.some((id) => /stadium/.test(id)) && !venue && !opts.stadiumOk) return false;
  return true;
}

/** A company that performs somewhere (New York City Ballet), not the building it performs in. */
const COMPANY_NAME = /\b(ballet|opera company|dance company|dance theat(re|er) of|symphony orchestra|philharmonic orchestra|chamber orchestra|choir|chorus|repertory company)\b/i;
const BUILDING_WORD = /\b(theat(re|er)|hall|house|cent(er|re)|auditorium|stage|arena|ballroom|pavilion)\b/i;

/** The rules a room's name alone can settle (so they apply to stored tours too): fairs, housing, galleries for
 *  big crowds, bars and cafés, stadiums. */
export function roomNameOk(name: string, draw?: number): boolean {
  if (NOT_A_ROOM_NAME.test(name) || NOT_A_ROOM_EVER.test(name) || isPark(name)) return false;
  if (COMPANY_NAME.test(name) && !BUILDING_WORD.test(name)) return false;
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

/** Two nights cover the crowd: the room holds 50–60% of it (one night would turn half the fans away; two hold them
 *  all). */
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

/** A measured room short of the crowd but within reach of it (40–50%): one night, and the sheet says how short. */
export function shortHouse(r: Room, draw?: number): boolean {
  return Boolean(draw && r.capacity && r.capacity.value >= draw * SHORT_MIN && r.capacity.value < draw * TWO_NIGHT_MIN);
}

/**
 * What a room's name and Qloo tags say about its size when nobody could measure it: "small" for a music school, a
 * DIY space, a youth centre, a collective, an "underground" room, an abbey or church arts centre, a bar (Swallow
 * Hill Music, Seventh Circle Music Collective, The Vera Project, Fremont Abbey Arts Center); "large" for a theatre,
 * auditorium, ballroom, hall, music hall or amphitheatre, and the Fillmores and the Ogden. Only a guess: it orders
 * rooms nobody measured and is never shown as a capacity. Small wins when both match ("Theatre Off Jackson" is a
 * theatre by name; its tags don't say small, so it stays large).
 */
// Not "academy" (O2 Academy Bristol holds 1,600) and not "house of" (House of Blues).
const SMALL_PRIOR_NAME = /\b(music school|school of music|conservatory|diy|youth|collective|underground|abbey|church|chapel|coffee ?house|caf[eé]|tavern|pub|bar|lounge|basement|gallery|studios?|community cent(er|re)|vfw|legion)(?![a-z])/i;
const SMALL_PRIOR_TAG = /^(diy|youth center|youth centre|youth empowerment|music instructor|music lessons|music school|sober space|converted church aesthetic|church|dive bar|dive bar aesthetic|full bar|barebones|house shows?|coffee shop)$/i;
const LARGE_PRIOR_NAME = /\b(theat(re|er)|auditorium|ballroom|hall|music hall|amphithea(tre|ter)|arena|coliseum|pavilion|opera house|fillmore|ogden|performing arts|event center|events center|palladium|paramount|orpheum)\b/i;
const LARGE_PRIOR_TAG = /^(music hall|amphitheater|amphitheatre|arena|performing arts venue|theater house|ballroom|concert venue)$/i;

export function sizePrior(r: Pick<Room, "name" | "tags">): "small" | "large" | undefined {
  const tags = r.tags ?? [];
  if (SMALL_PRIOR_NAME.test(r.name) || tags.some((t) => SMALL_PRIOR_TAG.test(t.trim()))) return "small";
  if (LARGE_PRIOR_NAME.test(r.name) || tags.some((t) => LARGE_PRIOR_TAG.test(t.trim()))) return "large";
  return undefined;
}

/** From this crowd up, an unmeasured room's size prior orders it, and a small one alone isn't bookable at 1,500. */
export const PRIOR_DRAW = 1000;
export const SMALL_ONLY_DRAW = 1500;

/**
 * How good a room is for this crowd, lower is better: 0 a known snug fit (85–130% of the draw); 0.2 any other known fit (60–250%, one night); 1 a known
 * two-night stand (50–60%); 1.5 a known room up to four times the crowd, in a reduced configuration; 1.8 a known
 * room at 40–50% of the crowd, one night; then a room whose capacity couldn't be found (2 for a crowd under 3,000,
 * where clubs are rarely on Wikidata; 2.5 from 3,000 up, where an unmeasured room is nearly always a small one;
 * from 1,000 up a name or tags that say theatre take 0.1 off and ones that say music school or DIY add 0.6, so
 * the Ogden goes before Swallow Hill Music); then rooms known to miss by how far they miss. So a measured room at
 * 40–250% always beats one nobody measured (Ghost's 8,000 crowd once got Strom, a club nobody could measure).
 */
/**
 * A room a touring act can't sell tickets in the usual way: a free civic stage in a public park (Miller Outdoor
 * Theatre) or a university's own arena or fieldhouse (Chiles Center, Fertitta Center), by Qloo's place tags or the
 * Wikidata description stored with its capacity. Booked only when nothing else in the city can be (Oct 30 judges).
 */
export function civicOrCampus(r: Pick<Room, "tags" | "capacity">): boolean {
  return /\b(public park setting|academic campus|campus traditions)\b/i.test(r.tags.join(" | ")) || /\b(universit(y|é|à)|college) campus\b|\bon the [^;]*\bcampus\b|\buniversity\b[^;]*\barena\b/i.test(r.capacity?.quote ?? "");
}

export function roomGrade(r: Room, draw?: number): number {
  if (!draw) return 0;
  if (civicOrCampus(r)) return 2.9 + roomGradeOf(r, draw) / 10;
  return roomGradeOf(r, draw);
}

function roomGradeOf(r: Room, draw: number): number {
  const f = fit(r, draw);
  // One night, in a booker's order: a close fit (85–130% of the crowd), then a room the fans sell out (60–85%), then
  // a loose fit (130–250%). Selling out a slightly small room beats half-filling a big one: the Crystal Ballroom's
  // 1,500 before Arlene Schnitzer's 2,776, the Orange Peel's 1,050 before Thomas Wolfe's 2,431.
  // Under 65% of the crowd the room turns away more than a third of the fans: a loose fit up to 160% comes first then
  // (Turnstile's Denver: the Fillmore's 3,900 before the Ogden's 1,600 for 2,500; Oct 30 judges).
  if (f === "fits") {
    const share = r.capacity!.value / draw;
    const g = roomFit(r, draw);
    return g === "close" ? 0 : g === "sells out" ? (share >= 0.65 ? 0.1 : 0.22) : share <= 1.6 ? 0.2 : 0.3;
  }
  if (twoNights(r, draw)) return 1;
  if (reducedHouse(r, draw)) return 1.5;
  if (shortHouse(r, draw)) return 1.8;
  if (f === "unknown") {
    const base = draw >= BIG_ROOM_DRAW ? 2.5 : 2;
    const prior = draw >= PRIOR_DRAW ? sizePrior(r) : undefined;
    return base + (prior === "large" ? -0.1 : prior === "small" ? 0.6 : 0);
  }
  return 3 + Math.abs(Math.log(r.capacity!.value / draw));
}

/** Where a measured one-night room sits in the booker's order; undefined outside 60–250% or unmeasured. */
export function roomFit(r: Room, draw?: number): "close" | "sells out" | "loose" | undefined {
  if (!draw || !r.capacity || fit(r, draw) !== "fits") return undefined;
  return snugFit(r.capacity.value, draw) ? "close" : r.capacity.value < draw * SNUG.min ? "sells out" : "loose";
}

/** A room's size in words for the call sheet and the agent: "a close fit", "one the fans sell out", "a loose fit",
 *  else what fit() says ("too small", "too big", "unknown"). */
export function fitWord(r: Room, draw?: number): string {
  const f = roomFit(r, draw);
  return f === "close" ? "a close fit" : f === "sells out" ? "one the fans sell out" : f === "loose" ? "a loose fit" : fit(r, draw);
}

/** The room to book: the best grade; among equals the agent's choice, then Qloo's order (fan affinity). */
export function chooseRoom(rooms: Room[], wanted: string | undefined, draw?: number): Room | undefined {
  if (!rooms.length) return undefined;
  const order = [...rooms].sort((a, b) => roomGrade(a, draw) - roomGrade(b, draw) || Number(b.id === wanted) - Number(a.id === wanted) || rooms.indexOf(a) - rooms.indexOf(b));
  return order[0];
}

/**
 * Whether a city has a room this crowd can be booked into, for the planner: the room chooseRoom would book, and
 * `bookable` false when the city should give way to the next ranked one. Not bookable: no room at all; only rooms
 * known to miss the crowd (under 40% of it, or over four times); or, for a crowd of 3,000 or more, only rooms
 * nobody could measure (an unmeasured room at that size is nearly always a club); or, for a crowd of 1,500 or
 * more, only unmeasured rooms whose names or tags say small (sizePrior: Barboza, a 100-cap bar, for 1,500).
 * Otherwise an unmeasured room below 3,000 is bookable: clubs are rarely on Wikidata, and the pitch asks the room
 * what it holds.
 */
export type RoomCheck = { room?: Room; bookable: boolean; status: "measured" | "unmeasured" | "misfit" | "none"; reason?: string };

export function roomCheck(rooms: Room[], wanted: string | undefined, draw?: number): RoomCheck {
  const room = chooseRoom(rooms, wanted, draw);
  if (!room) return { bookable: false, status: "none", reason: "no room of this kind came back" };
  if (!draw) return { room, bookable: true, status: room.capacity ? "measured" : "unmeasured" };
  if (room.capacity && roomGrade(room, draw) < 2) return { room, bookable: true, status: "measured" };
  const crowd = draw.toLocaleString("en-US");
  if (!room.capacity) {
    if (draw >= BIG_ROOM_DRAW) return { room, bookable: false, status: "unmeasured", reason: `no room these fans go to could be measured for a crowd of ${crowd}` };
    // chooseRoom puts a small-sounding room last among the unmeasured, so this one being small means they all are.
    if (draw >= SMALL_ONLY_DRAW && sizePrior(room) === "small") return { room, bookable: false, status: "unmeasured", reason: `the only rooms left, like ${room.name}, couldn't be measured and look small for a crowd of ${crowd}` };
    return { room, bookable: true, status: "unmeasured" };
  }
  return { room, bookable: false, status: "misfit", reason: `the nearest size, ${room.name} at ${room.capacity.value.toLocaleString("en-US")}, is ${room.capacity.value < draw ? "under 40%" : "over four times"} of a crowd of ${crowd}` };
}

/* ───────────────────────── a market's room ladder ───────────────────────── */

/**
 * A market's rooms by size, from Wikidata: items with a maximum capacity (P1083) within about 30 km
 * (lib/wikidata.ts wikidataRoomsNear). Qloo returns the rooms its fans' graph links to a venue tag, so a city's
 * arena can be missing from its answer (Munich came back with no Olympiahalle or Zenith); the ladder says what
 * sizes the market has. It never ranks: Qloo's affinity order decides within a size tier.
 */
export type LadderRoom = { qid: string; name: string; description?: string; lat?: number; lon?: number; capacity: number; /** Wikidata instance-of labels (P31): "indoor arena", "concert hall", "ice rink". */ types?: string[] };

/** A Wikidata item counts as a room when its name or description says venue, and the room rules allow it. */
const LADDER_KIND = /\b(music venue|concert (hall|venue)|arena|amphithea(tre|ter)|theat(re|er)|auditorium|ballroom|opera house|coliseum|colosseum|pavilion|event venue|performing arts|nightclub|music hall|multi-purpose)\b/i;
const LADDER_NOT = /\b(stadium|ballpark|church|cathedral|school|university|college|museum|cinema|movie theat(re|er)|racecourse|velodrome|swimming|ice rink|ice (skating|hockey) (arena|rink|venue)|skating (arena|rink)|curling|demolished|former|defunct)\b/i;
/** Instance-of types that make an item a sports floor, not a room (Richard J. Codey Arena: "ice skating arena"). */
const LADDER_NOT_TYPE = /ice rink|skating rink|ice hockey|bicycle|sports hall|gymnasium|natatorium/i;
/** A room built for music or stage first: looked up before a sports arena of the same size. */
export const concertRoom = (l: LadderRoom) => /concert|music venue|music hall|theat|opera|amphithea|multi-purpose|event venue|entertainment venue|performing arts/i.test(`${l.description ?? ""} ${(l.types ?? []).join(" ")}`);

/** The ladder: Wikidata rows that are rooms for this crowd, one per item, smallest first. */
export function roomLadder(rows: LadderRoom[], draw?: number): LadderRoom[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => r.capacity >= 50 && r.capacity <= 120_000 && LADDER_KIND.test(`${r.name} ${r.description ?? ""} ${(r.types ?? []).join(" ")}`) && !LADDER_NOT.test(r.description ?? "") && !(r.types ?? []).some((t) => LADDER_NOT_TYPE.test(t)) && roomNameOk(r.name, draw))
    .filter((r) => !seen.has(r.qid) && Boolean(seen.add(r.qid)))
    .sort((a, b) => a.capacity - b.capacity);
}

/** The ladder's rooms at a one-night fit (60–250%) for this crowd, smallest first. */
export function ladderTier(ladder: LadderRoom[], draw: number): LadderRoom[] {
  return ladder.filter((r) => r.capacity >= draw * 0.6 && r.capacity <= draw * 2.5);
}

/**
 * Merges a ladder into a city's Qloo rooms. A Qloo room with no capacity takes the ladder item that is the same
 * room (its distinctive words, within 2 km when both have coordinates), with the Wikidata source; the Qloo rooms
 * keep Qloo's order. The fitting ladder rooms Qloo didn't return come back as `extras`, for the planner to look up
 * on Qloo (for their fan affinity) when no Qloo room is bookable.
 */
export function mergeLadder(rooms: Room[], ladder: LadderRoom[], draw?: number): { rooms: Room[]; extras: LadderRoom[] } {
  const used = new Set<string>();
  const close = (r: Room, l: LadderRoom) => r.lat === undefined || r.lon === undefined || l.lat === undefined || l.lon === undefined || kmBetween({ lat: r.lat, lon: r.lon }, { lat: l.lat, lon: l.lon }) <= 2;
  const out = rooms.map((r) => {
    const l = ladder.find((x) => !used.has(x.qid) && sameVenue(r.name, x.name, x.description) && close(r, x));
    if (!l) return r;
    used.add(l.qid);
    if (r.capacity) return r;
    return { ...r, capacity: { value: l.capacity, source: `https://www.wikidata.org/wiki/${l.qid}`, quote: `${l.name}${l.description ? `: ${l.description}` : ""}; maximum capacity ${l.capacity.toLocaleString("en-US")} (Wikidata P1083)` } };
  });
  return { rooms: out, extras: draw ? ladderTier(ladder, draw).filter((l) => !used.has(l.qid)) : [] };
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

/**
 * The tastes Qloo's audience comparison says two acts' fans share, kept only when both acts are filed under them
 * (Turnstile and End It "shared" Rockabilly; Zach Bryan and Parker McCollum "shared" Jazz). When either act has no
 * genres on Qloo nothing can be confirmed, so nothing is kept.
 */
export function sharedGenres(shared: string[], headliner: string[], opener: string[] | undefined): string[] {
  const h = new Set(headliner.map(foldGenre));
  const o = new Set((opener ?? []).map(foldGenre));
  return shared.filter((t) => {
    const g = foldGenre(t);
    return Boolean(g) && !NOT_A_GENRE.test(g) && h.has(g) && o.has(g);
  });
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

/** How far below the headliner a support act's Qloo popularity percentile sits: at least 5 points (a peer is a
 *  co-headliner), at most 35 (an arena run doesn't carry a club act). */
export const SUPPORT_GAP = { min: 0.05, max: 0.35 };

/**
 * Why an artist Qloo suggests can't open for this headliner, or null when they can: the headliner themselves,
 * a shared name word (a solo member or side project), a member of the headliner or of another band (Grian
 * Chatten fronts Fontaines D.C.; Kirk Hammett plays in Metallica), not 5 to 35 popularity points below the
 * headliner, or no genre in common (bluegrass under post-punk, country under disco-funk).
 */
export function openerProblem(headliner: { id?: string; name: string; popularity?: number; genres: string[] }, cand: { id?: string; name: string; description?: string; popularity?: number; genres: string[] }): string | null {
  if (cand.id && cand.id === headliner.id) return "the headliner";
  if (foldName(cand.name) === foldName(headliner.name)) return "the headliner";
  if (sharesName(headliner.name, cand.name)) return "shares the headliner's name";
  if (isMember(headliner.name, cand)) return `a member of ${headliner.name}`;
  if (isSideMember(cand.description)) return "a member of another band";
  if (headliner.popularity !== undefined && cand.popularity !== undefined) {
    if (cand.popularity >= headliner.popularity) return "not smaller than the headliner";
    if (cand.popularity > headliner.popularity - SUPPORT_GAP.min) return "a co-headliner, not a support act";
    if (cand.popularity < headliner.popularity - SUPPORT_GAP.max) return "too small for the headliner's rooms";
  }
  if (!sharesGenre(headliner.genres, cand.genres)) return "no genre in common";
  return null;
}

/**
 * One support act for the whole run (it travels with the tour, as on a real tour): the opener the agent picked
 * most often; ties go to the one that turned up in the most cities' lookups, then to the higher summed affinity.
 * Returns undefined when no city has an opener.
 */
/**
 * How much smaller a support act must be than the headliner, on Qloo's popularity percentile: its distance from the
 * top (1 − popularity) at least this many times the headliner's. Lukas Nelson & Promise of the Real (0.84) for Sierra
 * Ferrell (0.91) is 1.9 times, a co-headliner priced like one; Kelsey Waldon (0.59) is 4.7 times. Every support the
 * Oct 25 poster wall booked otherwise cleared 3.5.
 */
export const SUPPORT_RATIO = 2.5;
export const smallEnough = (o: { popularity?: number }, headliner?: number) =>
  headliner === undefined || o.popularity === undefined || 1 - o.popularity >= SUPPORT_RATIO * Math.max(0.005, 1 - headliner);

/** A supergroup of headliners (The Highwomen: Brandi Carlile, Amanda Shires…) doesn't open, whatever its Qloo score. */
export const supergroup = (o: { description?: string }) => /\bsupergroup\b/i.test(o.description ?? "");

export function pickSupport<O extends { id: string; affinity?: number; popularity?: number; description?: string }>(stops: { openers: O[]; openerId?: string }[], headliner?: number): O | undefined {
  const all = pickSupportFrom(stops).filter((o) => !supergroup(o));
  return all.find((o) => smallEnough(o, headliner)) ?? all[0];
}

/** Every support candidate on the run, best first: the agent's votes, then how many cities' lookups found it, then affinity. */
function pickSupportFrom<O extends { id: string; affinity?: number }>(stops: { openers: O[]; openerId?: string }[]): O[] {
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
  return [...tally.values()].sort((a, b) => b.votes - a.votes || b.seen - a.seen || b.aff - a.aff).map((t) => t.o);
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
  // From 1,000 up, a theatre or a hall by name is measured before an unlabelled room, and a music school last.
  const p = (r: Room) => (draw >= PRIOR_DRAW && !r.capacity ? (sizePrior(r) === "large" ? 0 : sizePrior(r) === "small" ? 2 : 1) : 1);
  return [...rooms].sort((a, b) => misses(a) - misses(b) || p(a) - p(b) || (draw >= 1000 ? (b.popularity ?? 0) - (a.popularity ?? 0) : (b.affinity ?? 0) - (a.affinity ?? 0)));
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
