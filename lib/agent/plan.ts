import { km, marketById, marketLabel } from "../geo/markets";
import { ANCHOR_RANK, capCountries, describeTradeOff, HOME_RANK, homeCity, isAnchor, keepAnchors, keepHome, longLegs, MAX_LEG_KM, orderStops, radiusFor, repairLegs, roadKm, tooClose } from "../geo/route";
import type { RegionId } from "../geo/markets";
import { populationRanking } from "../headtohead";
import type { Msg } from "../nebius";
import type { AgentCheck, Artist, Audience, Capacity, CityScore, LogLine, Opener, QlooDiff, Room } from "../types";
import { AGE_LABEL, topAge } from "./audience";
import { fit } from "./evidence";
import { blendOrder, diffLine, qlooDiff, sizeRanks, type Ranks } from "./qloodiff";
import { BIG_ROOM_DRAW, candidatesBySize, chooseRoom, fitWord, pickSupport, SUPPORT_RATIO, roomFit, roomNameOk, sizePrior, REDUCED_MAX, reducedHouse, roomCheck, roomGrade, twoNights } from "./rooms";
import type { Log } from "./tools";
import { concertRoom, type LadderRoom } from "./rooms";

/**
 * The agent, in the moves a booking agent would make:
 *  1. Shortlist (model): from Qloo's heatmap in blend order (fan rank weighed against city size, the ranking that
 *     beat size alone on real tours), choose the cities worth a look plus a few alternates.
 *  2. Scout (tools): for every shortlisted city, ask Qloo for the rooms these fans go to and the openers who
 *     share the audience; with a known crowd, measure the likeliest rooms before booking.
 *  3. Book (model): pick the final cities, one room each and one support act for the run, knowing what each room
 *     holds, with a one-sentence reason that cites the evidence.
 *  4. Check (rules as a tool): check_plan runs the tour's rules over the booking and sends every objection back to
 *     the agent, which re-books; at most MAX_REVISIONS rounds (3), a round kept only when `better` holds (fewer
 *     objections and no longer worst leg), or only its changes that help on their own. In a round
 *     the agent may ask Routed to scout up to SCOUT_PER_ROUND cities it hasn't seen (scout_city). Only what is
 *     still broken after that is fixed by a rule, and the leg cap is then enforced from scouted cities.
 *  5. Reasons (model): once the rules have settled, the agent writes the reason for any stop a rule changed.
 * A free-running tool loop was tried first: Nemotron repeated lookups and ran out of turns on most tours
 * (measured Oct 7), so the moves are fixed and the choices are the model's. Rules hold it in (Playbook L1/L2):
 * cities must come from the candidates, the radius clause is enforced, a major market in the top ten stays, no
 * leg between shows runs over MAX_LEG_KM where a city could close it, rooms are sized to the crowd, and one
 * support act plays the whole run. Without the model (no key, budget spent, it fails or the deadline passes) the
 * same steps run as a fixed plan. Afterwards the same rules run once on city size alone, with no Qloo or model
 * call, to show which stops Qloo changed.
 *
 * No I/O of its own: the model, Qloo and the web are passed in (run.ts), so the guard, the check and the
 * fallbacks are tested with fakes (test/agent.test.ts).
 */

export type Pick = { marketId: string; rooms: Room[]; roomId?: string; openers: Opener[]; openerId?: string; why?: string; nights?: number; modelRoomId?: string; modelOpenerId?: string; /** Why no room could be booked, when no city in reach had one either. */ noRoom?: string };

export type BookStop = { city_id: string; room_id: string; opener_id: string; why: string };

export type PlanResult = {
  picks: Pick[];
  planned: "model" | "fixed";
  model?: string;
  check?: AgentCheck;
  qlooDiff?: QlooDiff;
  /** The hometown show, when the starting city is on the tour by the hometown rule: the run opens there. */
  homeId?: string;
  /** What the leg rule's swaps gave up and gained, in a booker's words. */
  tradeOff?: string;
};

/** A strict-JSON model call (lib/nebius.ts structured, bound to the agent's model chain). */
export type Ask = <T>(opts: { name: string; schema: Record<string, unknown>; messages: Msg[]; maxTokens?: number; timeoutMs?: number }) => Promise<{ data: T; model: string }>;

export type PlanDeps = {
  ask: Ask;
  lookUpRooms: (artist: Artist, marketId: string, log: Log, draw?: number) => Promise<Room[]>;
  lookUpOpeners: (artist: Artist, marketId: string, log: Log) => Promise<Opener[]>;
  /** A room the agent named, searched for on Qloo in that city; null when Qloo has no such room there. */
  findPlace?: (artist: Artist, name: string, marketId: string, draw?: number, onMiss?: (why: string) => void) => Promise<Room | null>;
  /** The artist's fans' affinity for these places, in one call. */
  scoreRooms?: (artist: Artist, ids: string[]) => Promise<Map<string, number>>;
  /** The city's rooms by capacity from Wikidata that fit this crowd, closest first. */
  ladderRooms?: (marketId: string, draw: number) => Promise<LadderRoom[]>;
  roomCapacity: (room: Room, city: string) => Promise<Capacity | null>;
};

export { MAX_LEG_KM };
export { ANCHOR_RANK };
/** How deep in the ranking the leg rule may look for a city that closes a long leg. */
export const POOL_SIZE = 60;
/** Rooms measured per city, after the agent's choice, until one is a close fit for the crowd. */
export const MEASURE_PER_CITY = 8;
/** Capacity lookups run this many at a time in a city (each still goes through the Wikidata and web gates). */
export const MEASURE_BATCH = 4;
/** How long the measuring before the book call may take. */
export const PRE_MEASURE_MS = 45_000;
/** Rooms measured per shortlisted city before the book call, in the order the room rule would measure them. */
export const PRE_MEASURE = 4;
/** check_plan's objections go back to the agent at most this many times. */
export const MAX_REVISIONS = 3;
/** Model calls the agent may add to shortlist + book: revision rounds and the final reasons together. */
export const EXTRA_CALLS = 4;
/** Qloo's strongest cities always shown to the agent, even when the blend ranks them lower. */
export const QLOO_TOP_SHOWN = 5;
/** Qloo's strongest fan cities, kept on the tour like anchors (any size): a tour never drops the artist's #1 city. */
export const FAN_KEEP = 3;
/**
 * How far down Qloo's fan map a city may be and still be a candidate. The blend lifts big cities, and without a cap
 * it lifted Chicago (fan #50) and Columbus (#35) over Asheville (#1) for Sierra Ferrell (Oct 25 smoke test). Past
 * it, a city is booked only when it closes a leg, or when the fan cities can't fill the run.
 */
export const FAN_CAP = 25;
/** Rooms the agent may name per shortlisted city, and the place searches a tour may spend finding them on Qloo (one
 *  more call scores their fan affinity). */
export const NAMED_PER_CITY = 2;
export const NAMED_SEARCHES = 15;
/** From this crowd up, a city with no one-night fit on Qloo's list also gets the Wikidata rooms of the right size. */
export const LADDER_DRAW = 1000;
/** Bridge cities tried (with their room lookups) to reach a fan city the run can't reach within the leg cap. */
export const BRIDGE_TRIES = 3;
/** A city within the fan cap, or a major market in the artist's top ten. */
export const inFanCap = (c: CityScore) => c.rank <= FAN_CAP || isAnchor({ rank: c.rank, pop: marketById(c.marketId)?.pop ?? 0 });
/** Cities tried in place of one with no bookable room (each costs its Qloo lookups and a few measurements). */
export const ROOM_SWAP_TRIES = 3;
/** A model call isn't started with less of the planning share left than this. */
const MIN_MODEL_MS = 8000;

const popOf = (id: string) => marketById(id)?.pop ?? 0;
const n = (v: number) => v.toLocaleString("en-US");

/** Words that don't tell two rooms apart: articles and connectors in the languages tours play, and room kinds. */
const ROOM_WORDS = new Set(["the", "at", "of", "and", "le", "la", "les", "l", "il", "lo", "el", "los", "las", "di", "de", "du", "des", "del", "della", "dei", "der", "den", "das", "het", "theatre", "theater", "teatro", "theatro", "hall", "auditorium", "music", "venue", "club", "live", "center", "centre", "arena", "ballroom", "amphitheatre", "amphitheater"]);

const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** A city's names as rooms carry them ("Alcatraz Milano", "Le Zénith Paris"): its English and ASCII names and the
 *  local name. They are dropped before two room names are compared. */
const LOCAL_NAMES: Record<string, string[]> = { milan: ["milano"], munich: ["munchen", "muenchen"], cologne: ["koln", "koeln"], vienna: ["wien"], rome: ["roma"], naples: ["napoli"], turin: ["torino"], florence: ["firenze"], venice: ["venezia"], prague: ["praha"], lisbon: ["lisboa"], brussels: ["bruxelles", "brussel"], copenhagen: ["kobenhavn"], warsaw: ["warszawa"], geneva: ["geneve", "genf"], zurich: ["zuerich"], gothenburg: ["goteborg"], antwerp: ["antwerpen"], seville: ["sevilla"], athens: ["athina"], "the hague": ["den haag"], "new york": ["nyc"] };
export function placeWords(m?: { name: string; ascii?: string }): string[] {
  if (!m) return [];
  const names = [m.name, m.ascii ?? "", ...(LOCAL_NAMES[fold(m.name)] ?? [])].map(fold).filter(Boolean);
  return [...new Set(names.flatMap((x) => x.split(" ")))].filter((w) => w.length > 2);
}

/**
 * Rooms known under more than one name (a sponsor's rename, a local name): two names in one group are one room.
 * Hand-checked; the first name is the one Qloo lists today where we've seen it (Unipol Forum, Oct 26).
 */
export const ROOM_ALIASES: string[][] = [
  ["Unipol Forum", "Mediolanum Forum", "Forum di Milano", "Forum di Assago", "Forum Assago", "Assago Forum"],
  ["Accor Arena", "AccorHotels Arena", "Bercy Arena", "Palais Omnisports de Paris-Bercy", "Paris Bercy"],
  ["Zénith Paris – La Villette", "Le Zénith", "Zénith Paris", "Zénith de Paris"],
  ["OVO Arena Wembley", "Wembley Arena", "SSE Arena Wembley"],
  ["Uber Arena", "Mercedes-Benz Arena Berlin", "O2 World Berlin"],
  ["Lanxess Arena", "Kölnarena"],
  ["AFAS Live", "Heineken Music Hall"],
  ["Crypto.com Arena", "Staples Center"],
  ["Kia Forum", "The Forum Inglewood", "Great Western Forum"],
  ["Ball Arena", "Pepsi Center"],
  ["Paycom Center", "Chesapeake Energy Arena"],
  ["Climate Pledge Arena", "KeyArena"],
  ["Moda Center", "Rose Garden Arena"],
];
/** The other names a room is known by (folded), or none. */
export function aliasesOf(name: string): string[] {
  const key = (s: string) => fold(s).split(" ").filter((w) => !ROOM_WORDS.has(w)).join(" ");
  const k = key(name);
  return ROOM_ALIASES.find((g) => g.some((x) => key(x) === k))?.filter((x) => key(x) !== k) ?? [];
}

/**
 * Two room names are the same room: folded, without "the", punctuation and words like "theatre" or "hall"
 * that sites add or drop ("Ryman" and "Ryman Auditorium"; "The Basement East" and "Basement East", but never
 * "The Basement" and "The Basement East").
 */
/** Operators and brands that some lists put before a room's own name and others drop ("McMenamins Crystal Ballroom" is
 *  the "Crystal Ballroom"). Stripped only when a name is left after it. */
export const OPERATOR_PREFIX = /^\s*(the\s+)?(mcmenamins|house of blues|brooklyn bowl|fillmore|live nation|aeg presents|c3 presents|first avenue)\b[\s:'’-]*/i;
export const withoutOperator = (s: string) => {
  const t = s.replace(OPERATOR_PREFIX, "").trim();
  return t.length >= 3 ? t : s;
};

export function sameRoomName(a: string, b: string, place: string[] = []): boolean {
  if (OPERATOR_PREFIX.test(a) !== OPERATOR_PREFIX.test(b) && sameRoomWords(withoutOperator(a), withoutOperator(b), place)) return true;
  return sameRoomWords(a, b, place);
}

function sameRoomWords(a: string, b: string, place: string[] = []): boolean {
  const words = (s: string) => fold(s).split(" ").filter((w) => w.length > 1 && !ROOM_WORDS.has(w) && !place.includes(w));
  const x = [...new Set(words(a))], y = [...new Set(words(b))];
  if (!x.length || !y.length) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  // The same words, or a two-word name with one word added ("Thomas Wolfe Auditorium" is not "Thomas Wolfe Memorial
  // State Historic Site"; "Basement" and "Basement East" are two rooms).
  return short.every((w) => long.includes(w)) && (long.length === short.length || (short.length >= 2 && long.length - short.length <= 1));
}

/**
 * Whether a name someone asked for is the room Qloo returned: the names as written, the asked name without its
 * "at the …" (the "ACL Live" of "ACL Live at the Moody Theater"), and the aliases Qloo lists in parentheses
 * ("Austin City Limits Live (ACL Live & 3TEN ACL Live)").
 */
export function roomNameMatches(asked: string, qloo: string, place: string[] = []): boolean {
  const mine = [asked, asked.split(/\s+at\s+(?:the\s+)?/i)[0]!, ...aliasesOf(asked)].filter((x) => x.trim());
  const inner = [...qloo.matchAll(/\(([^)]*)\)/g)].flatMap((m) => m[1]!.split(/\s*(?:&|,|\/|\band\b)\s*/i));
  const theirs = [qloo, qloo.replace(/\s*\([^)]*\)/g, ""), ...inner].map((x) => x.trim()).filter(Boolean);
  return mine.some((a) => theirs.some((b) => sameRoomName(a, b, place)));
}

/** The live shortlist also asks for the rooms the agent would book in each city (names only; Qloo finds them). The
 *  head-to-head keeps SHORTLIST_SCHEMA, its pre-registered protocol. */
const LIVE_SHORTLIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cities: { type: "array", items: { type: "object", additionalProperties: false, properties: { city_id: { type: "string" }, why: { type: "string" }, rooms: { type: "array", items: { type: "string" } } }, required: ["city_id", "why", "rooms"] } },
    alternates: { type: "array", items: { type: "string" } },
  },
  required: ["cities", "alternates"],
};

export const SHORTLIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cities: { type: "array", items: { type: "object", additionalProperties: false, properties: { city_id: { type: "string" }, why: { type: "string" } }, required: ["city_id", "why"] } },
    alternates: { type: "array", items: { type: "string" } },
  },
  required: ["cities", "alternates"],
};

/** scout_city: how many cities the agent may ask Routed to scout on Qloo in one revision round (Oct 30). */
export const SCOUT_PER_ROUND = 2;

/** A re-booking, with the agent's own scouting requests (scout_city): city_ids it wants looked up on Qloo now. */
const REBOOK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    stops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { city_id: { type: "string" }, room_id: { type: "string" }, opener_id: { type: "string" }, why: { type: "string" } },
        required: ["city_id", "room_id", "opener_id", "why"],
      },
    },
    scout: { type: "array", items: { type: "string" } },
  },
  required: ["stops", "scout"],
};

const BOOK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    stops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { city_id: { type: "string" }, room_id: { type: "string" }, opener_id: { type: "string" }, why: { type: "string" } },
        required: ["city_id", "room_id", "opener_id", "why"],
      },
    },
  },
  required: ["stops"],
};

const REASONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { reasons: { type: "array", items: { type: "object", additionalProperties: false, properties: { city_id: { type: "string" }, why: { type: "string" } }, required: ["city_id", "why"] } } },
  required: ["reasons"],
};

export const role = (artist: string) =>
  `You are a booking agent routing a tour for ${artist}. Your evidence is Qloo's taste graph for ${artist}'s fans: a heatmap ranking of cities, and per-city lists of the rooms those fans go to and the artists (possible openers) who share the audience. Openers are other artists, never ${artist}. Use only numbers from the evidence.`;

/**
 * The candidate table. With `ranks` (the live agent) each row carries the blend rank it is sorted by, Qloo's fan
 * rank and the city's size rank side by side, fan affinity in its own column; without (the head-to-head's
 * pre-registered protocol) the table reads exactly as it did when that test was committed.
 */
export function table(cities: CityScore[], from: { lat: number; lon: number }, RADIUS_KM: number, ranks?: Ranks, mustKeep?: Set<string>): string {
  const signal = (c: CityScore) => (c.popularity !== undefined ? ` | signal ${Math.round(c.popularity * 100)}` : "");
  const rows = cities.map((c) =>
    ranks
      ? `${c.marketId} | ${c.label} | #${ranks.blend.get(c.marketId) ?? "–"} | #${c.rank} | #${ranks.pop.get(c.marketId) ?? "–"} | affinity ${Math.round(c.affinity * 100)}${signal(c)} | ${n(popOf(c.marketId))} people | ${Math.round(km(from, c))} km from start${mustKeep?.has(c.marketId) ? " | MUST KEEP (a top-3 fan city)" : ""}`
      : `${c.marketId} | ${c.label} | #${c.rank} | affinity ${Math.round(c.affinity * 100)}${signal(c)} | ${Math.round(km(from, c))} km from start`,
  );
  const close: string[] = [];
  const at = (c: CityScore) => ({ lat: c.lat, lon: c.lon, pop: popOf(c.marketId) });
  for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) if (tooClose(at(cities[i]!), at(cities[j]!), RADIUS_KM)) close.push(`${cities[i]!.marketId} ~ ${cities[j]!.marketId}`);
  const head = ranks ? "city_id | city | blend rank (fan rank and size rank averaged) | fan rank on Qloo | size rank by metro population | fan affinity (0-100) | taste signal (0-100) | metro population | distance" : "city_id | city | strength rank | fan affinity (0-100) | taste signal (0-100) | distance";
  return `${head}\n${rows.join("\n")}${close.length ? `\n\nToo close to pair (radius clause, ${RADIUS_KM} km): ${close.join("; ")}` : ""}`;
}

/**
 * The shortlist question. The head-to-head (scripts/head-to-head.ts) asks it twice, once with Qloo's table and
 * once with a table of the region's biggest cities, so the only difference between its two arms is the evidence.
 */
export function shortlistPrompt(o: { brief: string; from: { label: string }; shows: number; draw?: number; source: string; table: string; prefer: string }): string {
  return `${o.brief}\nStarting from ${o.from.label}. Shows wanted: ${o.shows}.${o.draw ? ` Usual crowd: about ${o.draw}.` : ""}\n\n${o.source}:\n${o.table}\n\nShortlist exactly ${o.shows} cities for the tour (none of the pairs marked too close; keep every leg between shows under ${MAX_LEG_KM} km of road, so choose one part of the region rather than both coasts; never skip a major market such as London, New York or Paris when it is in the top ten), ${o.prefer}, each with a short reason, plus up to 3 alternate city_ids in case a city has no room that fits.`;
}

export function brief(artist: Artist, audience: Audience): string {
  const top = topAge(audience.age);
  return [
    `Artist: ${artist.name}${artist.genres.length ? ` (${artist.genres.slice(0, 4).join(", ")})` : ""}.`,
    top ? `Fans over-index most at ages ${AGE_LABEL[top.bucket]}.` : "",
    audience.tags.length ? `Fans' taste: ${audience.tags.slice(0, 6).map((t) => t.name).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const p100 = (v?: number) => (v === undefined ? null : Math.round(v * 100));
/** A city's rooms for the book call; with a crowd, `rule_pick` marks the room the size rule books (rooms.ts roomGrade: a
 *  measured fit beats any unmeasured room), so the agent books knowing what the rule would do. */
const compactRooms = (rooms: Room[], draw?: number) => {
  const pick = draw ? chooseRoom(rooms, undefined, draw)?.id : undefined;
  return rooms.map((r) => ({ id: r.id, name: r.name, affinity: p100(r.affinity), popularity: p100(r.popularity), kind: r.tags.slice(0, 3).join(", ") || null, capacity: r.capacity?.value ?? null, ...(draw ? { size: fit(r, draw) } : {}), ...(pick === r.id ? { rule_pick: true } : {}), ...(r.origin === "agent" ? { named_by_you: true } : {}) }));
};
const compactOpeners = (o: Opener[]) => o.map((x) => ({ id: x.id, name: x.name, affinity: p100(x.affinity), ...(x.genres?.length ? { genres: x.genres.slice(0, 3) } : {}) }));

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** A model call that can't outlive the planning share: whatever it is doing, the fixed plan gets the time back. */
function inTime<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms)) return p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, no) => (timer = setTimeout(() => no(new Error("the planning deadline passed")), Math.max(0, ms))));
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/* ───────────────────────── check_plan ───────────────────────── */

export type Objection = {
  /** The stop the objection is about (for an anchor, the market to add). */
  city_id?: string;
  rule: "candidate" | "duplicate" | "radius" | "rooms" | "room" | "leg" | "anchor" | "fan" | "home" | "count" | "support";
  /** What the agent is told. */
  text: string;
  /** The same in a few words, for the call sheet. */
  short: string;
  /** A leg objection's road km, so a booking that makes the worst leg longer is never counted as better. */
  km?: number;
};

export type CheckContext = { byId: Map<string, CityScore>; rooms: Map<string, Room[]>; shows: number; draw?: number; from: { lat: number; lon: number }; radius: number; /** Qloo's top fan cities, kept like anchors. */ mustKeep?: Set<string> };

const placed = (c: CityScore) => ({ lat: c.lat, lon: c.lon, pop: popOf(c.marketId) });
const sizeWord = (r: Room, draw?: number) => (r.capacity ? `holds ${n(r.capacity.value)}${draw ? ` (${fitWord(r, draw)} for about ${n(draw)})` : ""}` : "has no confirmed capacity");

/**
 * check_plan: the rules the tour will be held to, run over the agent's booking as it stands, returning each
 * objection in words the agent can act on (Playbook L1: rules return violations, the model chooses the fix).
 * Pure: it reads only what was already looked up, so asking costs nothing.
 */
export function checkPlan(stops: BookStop[], c: CheckContext): Objection[] {
  const out: Objection[] = [];
  const kept: { s: BookStop; score: CityScore }[] = [];
  for (const s of stops) {
    const score = c.byId.get(s.city_id);
    if (!score) {
      out.push({ city_id: s.city_id, rule: "candidate", text: `"${s.city_id}" isn't one of the candidate cities: use a city_id from the candidates.`, short: "not a candidate city" });
      continue;
    }
    if (kept.some((k) => k.score.marketId === score.marketId)) {
      out.push({ city_id: s.city_id, rule: "duplicate", text: `${score.name} is booked twice: one stop per city.`, short: "booked twice" });
      continue;
    }
    const near = kept.find((k) => tooClose(placed(k.score), placed(score), c.radius));
    if (near) {
      const d = Math.round(km(near.score, score));
      out.push({ city_id: s.city_id, rule: "radius", text: `${score.name} is ${d} km from ${near.score.name}, inside the ${c.radius} km radius clause: they share one audience, so keep one of them and book another city instead.`, short: `${d} km from ${near.score.name} (radius clause)` });
      continue;
    }
    const rs = c.rooms.get(score.marketId);
    if (rs && !rs.length) {
      out.push({ city_id: s.city_id, rule: "rooms", text: `Qloo found no rooms of the right kind in ${score.name}: book another city.`, short: "no rooms found" });
      continue;
    }
    kept.push({ s, score });
    if (!rs) continue;
    const room = rs.find((r) => r.id === s.room_id);
    if (!room) {
      out.push({ city_id: s.city_id, rule: "room", text: `"${s.room_id}" isn't one of ${score.name}'s rooms. Its rooms: ${rs.slice(0, 5).map((r) => `${r.id} (${r.name}, ${sizeWord(r, c.draw)})`).join("; ")}.`, short: "not one of the city's rooms" });
      continue;
    }
    // The room rule books the best size grade, the agent's choice among equals: an objection exactly when it would.
    const rc = roomCheck(rs, room.id, c.draw);
    if (!rc.bookable) {
      out.push({ city_id: s.city_id, rule: "room", text: `${score.name} has no room this crowd can be booked into (${rc.reason}): book another city.`, short: rc.reason ?? "no bookable room" });
      continue;
    }
    const best = c.draw ? chooseRoom(rs, room.id, c.draw) : undefined;
    // Both measured and both one-night rooms: say which is closer, in a booker's words.
    const closer = best && room.capacity && best.capacity && fit(room, c.draw) === "fits" && roomGrade(best, c.draw) < roomGrade(room, c.draw);
    if (best && best.id !== room.id)
      out.push({
        city_id: s.city_id,
        rule: "room",
        text: closer ? `${best.name} holds ${n(best.capacity!.value)}, a closer fit for about ${n(c.draw!)} than ${room.name}'s ${n(room.capacity!.value)} (${fitWord(room, c.draw)}): book ${best.name} (${best.id}). A booker would rather sell out a slightly small room than half-fill a big one.` : `${room.name} ${sizeWord(room, c.draw)}; the room rule would book ${best.name} (${best.id}), which ${sizeWord(best, c.draw)}. Book a room that fits the crowd.`,
        short: closer ? `${best.name} (${n(best.capacity!.value)}) is a closer fit than ${room.name}'s ${n(room.capacity!.value)}` : `${room.name} ${room.capacity ? `holds ${n(room.capacity.value)}, ${fitWord(room, c.draw)}` : "has no confirmed capacity"}`,
      });
  }

  const ordered = orderStops(c.from, kept.map((k) => k.score));
  for (const l of longLegs(c.from, ordered)) {
    const a = ordered[l.index - 1]!, b = ordered[l.index]!;
    const guarded = (x: CityScore) => Boolean(c.mustKeep?.has(x.marketId)) || isAnchor({ rank: x.rank, pop: popOf(x.marketId) });
    const rest = kept.map((k) => k.score).filter((x) => x.marketId !== b.marketId);
    const keepB = guarded(b) ? bridgeFix(rest, b, c, guarded) : "";
    const alt = keepB ? "" : clearing(rest, c);
    out.push({ city_id: b.marketId, rule: "leg", text: `${a.name} to ${b.name} is ${n(l.km)} km of road with no show between, over the ${n(MAX_LEG_KM)} km leg cap: keep the tour in one part of the region.${keepB ? ` ${b.name} is a city the rules keep, so bridge the route rather than drop it: ${keepB}.` : alt ? ` Cities that clear it in ${b.name}'s place: ${alt}.` : ""}`, short: `${n(l.km)} km leg from ${a.name}`, km: l.km });
  }
  // The radius objections get the same: cities that clear every rule from the stops kept so far.
  for (const o of out) {
    if (o.rule !== "radius" && o.rule !== "rooms" && o.rule !== "candidate") continue;
    const alt = clearing(kept.map((k) => k.score), c);
    if (alt) o.text += ` Cities that clear it: ${alt}.`;
  }

  // A major market in the top ten the route can reach stays on the tour (keepAnchors).
  for (const a of c.byId.values()) {
    if (!isAnchor({ rank: a.rank, pop: popOf(a.marketId) }) || kept.some((k) => k.score.marketId === a.marketId)) continue;
    if (kept.some((k) => isAnchor({ rank: k.score.rank, pop: popOf(k.score.marketId) }) && tooClose(placed(k.score), placed(a), c.radius))) continue;
    if (kept.length && !kept.some((k) => roadKm(k.score, a) <= MAX_LEG_KM)) continue;
    const anchorFix = bridgeFix(kept.map((k) => k.score), a, c, (x) => Boolean(c.mustKeep?.has(x.marketId)) || isAnchor({ rank: x.rank, pop: popOf(x.marketId) }));
    out.push({ city_id: a.marketId, rule: "anchor", text: `${a.name} (${a.marketId}) is a major market and #${a.rank} on the fan map: the anchor rule keeps it on the tour, so ${anchorFix || "book it in place of your weakest stop"}.`, short: `${a.name} is a major market, #${a.rank} (anchor rule)` });
  }

  // Qloo's top fan cities stay, whatever their size, when another candidate is within the leg cap of them.
  for (const id of c.mustKeep ?? []) {
    const f = c.byId.get(id);
    if (!f || kept.some((k) => k.score.marketId === id)) continue;
    if (![...c.byId.values()].some((x) => x.marketId !== id && roadKm(x, f) <= MAX_LEG_KM)) continue;
    const near = kept.find((k) => tooClose(placed(k.score), placed(f), c.radius));
    if (near && c.mustKeep!.has(near.score.marketId)) continue;
    const protectedCity = (x: CityScore) => Boolean(c.mustKeep?.has(x.marketId)) || isAnchor({ rank: x.rank, pop: popOf(x.marketId) });
    const fix = near ? "" : bridgeFix(kept.map((k) => k.score), f, c, protectedCity);
    // No booking the agent can make keeps it without a leg over the cap: the rules bridge it after the agent's turn.
    if (!near && !fix) continue;
    out.push({ city_id: id, rule: "fan", text: `${f.name} (${id}) is #${f.rank} on Qloo's fan map, one of the artist's ${FAN_KEEP} strongest fan cities: keep it on the tour${near ? `, in place of ${near.score.name} inside its radius` : `: ${fix}`}.`, short: `${f.name} is fan city #${f.rank} (kept like an anchor)` });
  }

  // The starting city, when it is in the artist's top HOME_RANK, opens the run (keepHome).
  const home = homeCity(c.from, [...c.byId.values()].map((x) => ({ ...x, id: x.marketId, pop: popOf(x.marketId) })));
  // Not when the hometown sits inside the radius of a city the anchor or fan rule keeps (Baltimore, #12, against
  // Philadelphia, #1): the stronger city stays, and the agent isn't sent round in circles.
  const guarded = (x: CityScore) => c.mustKeep?.has(x.marketId) || isAnchor({ rank: x.rank, pop: popOf(x.marketId) });
  const blocked = home && kept.some((k) => guarded(k.score) && tooClose(placed(k.score), placed(c.byId.get(home.id)!), c.radius));
  if (home && !blocked && !kept.some((k) => k.score.marketId === home.id)) out.push({ city_id: home.id, rule: "home", text: `${home.name} (${home.id}) is where the tour starts and #${home.rank} on the fan map (top ${HOME_RANK}): the hometown rule opens the run there, so book it in place of your weakest stop.`, short: `${home.name} is the hometown, #${home.rank}` });

  const replaced = out.filter((o) => ["candidate", "duplicate", "radius", "rooms"].includes(o.rule)).length;
  if (kept.length + replaced < c.shows) out.push({ rule: "count", text: `Only ${kept.length} of the ${c.shows} stops can be booked: book ${c.shows}.`, short: `${kept.length} of ${c.shows} stops usable` });
  if (new Set(kept.map((k) => k.s.opener_id)).size > 1) out.push({ rule: "support", text: "One support act travels with the whole run: use the same opener_id on every stop.", short: "one support act for the run" });
  return out;
}

/** How many alternatives an objection names. */
export const ALTERNATIVES = 4;

/**
 * Candidate cities that could take a stop's place and pass the rules against the stops kept: outside every kept
 * stop's radius, rooms not ruled out, and with every leg of the re-ordered run under the cap. Strongest fan rank
 * first, each with its road km to the nearest kept stop, so the agent can pick one that works ("albuquerque-us-nm
 * (Albuquerque, fan #4, 720 km from Denver)").
 */
export function clearing(kept: CityScore[], c: CheckContext, k = ALTERNATIVES): string {
  const out: string[] = [];
  const pool = [...c.byId.values()].filter((x) => !kept.some((y) => y.marketId === x.marketId)).sort((a, b) => a.rank - b.rank);
  for (const x of pool) {
    if (out.length >= k) break;
    if (kept.some((y) => tooClose(placed(y), placed(x), c.radius))) continue;
    const pick = bookableRoom(x, c);
    if (!pick) continue;
    const run = [...kept, x];
    if (longLegs(c.from, orderStops(c.from, run)).length) continue;
    const near = kept.length ? kept.reduce((best, y) => (roadKm(y, x) < roadKm(best, x) ? y : best)) : undefined;
    out.push(`${x.marketId} (${x.name}, fan #${x.rank}${near ? `, ${n(roadKm(near, x))} km from ${near.name}` : ""}; room_id ${pick})`);
  }
  return out.join("; ");
}

/** The room the rule would book in a scouted city, as the agent would name it (its id), or null when the city
 *  isn't scouted or nothing there can take the crowd. Only scouted cities are offered: a city the agent brings in
 *  unscouted comes back with a room id it had to guess. */
function bookableRoom(x: CityScore, c: CheckContext): string | null {
  const rs = c.rooms.get(x.marketId);
  if (!rs?.length) return null;
  const rc = roomCheck(rs, undefined, c.draw);
  return rc.bookable && rc.room ? rc.room.id : null;
}

/**
 * How to keep a city the rules want (a top fan city, an anchor) on a run whose legs would break without help: book
 * it in place of the weakest stop the rules don't protect, and, when one swap leaves a leg over the cap, a scouted
 * bridge city in place of the next weakest. Returns the fix in words with ids, or "" when none clears every leg.
 */
export function bridgeFix(kept: CityScore[], want: CityScore, c: CheckContext, protect: (x: CityScore) => boolean): string {
  const ok = (run: CityScore[]) => !longLegs(c.from, orderStops(c.from, run)).length && !run.some((a, i) => run.some((b, j) => j > i && tooClose(placed(a), placed(b), c.radius)));
  const room = bookableRoom(want, c);
  const weak = kept.filter((x) => !protect(x) && x.marketId !== want.marketId).sort((a, b) => b.rank - a.rank);
  const book = (x: CityScore, r: string | null) => `${x.name} (${x.marketId}${r ? `, room_id ${r}` : ""})`;
  for (const w of weak) {
    const run = [...kept.filter((x) => x !== w), want];
    if (ok(run)) return `book ${book(want, room)} in place of ${w.name}`;
  }
  const pool = [...c.byId.values()].filter((x) => x.marketId !== want.marketId && !kept.some((y) => y.marketId === x.marketId) && bookableRoom(x, c)).sort((a, b) => a.rank - b.rank).slice(0, 12);
  for (let i = 0; i < weak.length; i++)
    for (let j = 0; j < weak.length; j++) {
      if (i === j) continue;
      for (const x of pool) {
        const run = [...kept.filter((y) => y !== weak[i] && y !== weak[j]), want, x];
        if (ok(run)) return `book ${book(want, room)} in place of ${weak[i]!.name}, and ${book(x, bookableRoom(x, c))} in place of ${weak[j]!.name} to bridge the route`;
      }
    }
  return "";
}

/**
 * The agent's own changes, kept one at a time where they help: each change in its re-booking (a city swapped for
 * another, a room changed) is applied to the best booking so far on its own and kept when check_plan then objects
 * to less. A round that fixes the leg but breaks a room keeps the leg fix. Returns the merged booking and what was
 * kept, in the agent's words ("Louisville to Lexington"), or null when no single change helps.
 */
export function keepHelpful(best: BookStop[], next: BookStop[], check: (s: BookStop[]) => Objection[], name: (id: string) => string): { stops: BookStop[]; objections: Objection[]; kept: string[] } | null {
  type Edit = { label: string; apply: (s: BookStop[]) => BookStop[] | null };
  const edits: Edit[] = [];
  const gone = best.filter((p) => !next.some((x) => x.city_id === p.city_id));
  const came = next.filter((x) => !best.some((p) => p.city_id === x.city_id));
  for (const g of gone)
    for (const c of came)
      edits.push({ label: `${name(g.city_id)} to ${name(c.city_id)}`, apply: (s) => (s.some((x) => x.city_id === g.city_id) && !s.some((x) => x.city_id === c.city_id) ? s.map((x) => (x.city_id === g.city_id ? { ...c, opener_id: x.opener_id } : x)) : null) });
  for (const x of next) {
    const p = best.find((y) => y.city_id === x.city_id);
    if (p && p.room_id !== x.room_id) edits.push({ label: `the room in ${name(x.city_id)}`, apply: (s) => s.map((y) => (y.city_id === x.city_id ? { ...y, room_id: x.room_id } : y)) });
  }
  let stops = best;
  let objections = check(best);
  const kept: string[] = [];
  for (let improved = true; improved; ) {
    improved = false;
    for (const e of edits) {
      if (kept.includes(e.label)) continue;
      const cand = e.apply(stops);
      if (!cand) continue;
      const o = check(cand);
      if (better({ objections }, { objections: o })) {
        stops = cand;
        objections = o;
        kept.push(e.label);
        improved = true;
      }
    }
  }
  return kept.length ? { stops, objections, kept } : null;
}

/**
 * The leg cap enforced after the rules settle: while a leg between shows runs over `max`, swap one stop for a city
 * in `pool` (already scouted, with a bookable room) that lowers the road over the cap the most, never breaking the
 * radius clause, swapping out a protected stop (`keep`) only when nothing else works. Up to 4 swaps. Pure.
 */
export function enforceLegCap(o: { from: { lat: number; lon: number }; stops: CityScore[]; pool: CityScore[]; radius: number; first?: string; keep?: (c: CityScore) => boolean; max?: number }): { stops: CityScore[]; swaps: { out: CityScore; in: CityScore; before: number; after: number }[] } {
  const max = o.max ?? MAX_LEG_KM;
  const over = (run: CityScore[]) => {
    const ordered = orderStops(o.from, run.map((c) => ({ ...c, id: c.marketId })), { max, first: o.first && run.some((c) => c.marketId === o.first) ? o.first : undefined });
    const legs = longLegs(o.from, ordered, max);
    return { n: legs.length, excess: legs.reduce((t, l) => t + l.km - max, 0), worst: Math.max(0, ...legs.map((l) => l.km)) };
  };
  let stops = [...o.stops];
  const swaps: { out: CityScore; in: CityScore; before: number; after: number }[] = [];
  for (let k = 0; k < 4; k++) {
    const now = over(stops);
    if (!now.n) break;
    let best: { i: number; c: CityScore; s: ReturnType<typeof over>; prot: boolean } | null = null;
    for (const pass of [false, true]) {
      for (let i = 0; i < stops.length; i++) {
        const prot = Boolean(o.keep?.(stops[i]!));
        if (prot !== pass) continue;
        for (const c of o.pool) {
          if (stops.some((x) => x.marketId === c.marketId)) continue;
          const run = stops.map((x, j) => (j === i ? c : x));
          if (run.some((a, x) => run.some((b, y) => y > x && tooClose(placed(a), placed(b), o.radius)))) continue;
          const s = over(run);
          if (s.excess >= now.excess) continue;
          if (!best || s.n < best.s.n || (s.n === best.s.n && (s.excess < best.s.excess || (s.excess === best.s.excess && c.rank < best.c.rank)))) best = { i, c, s, prot };
        }
      }
      if (best) break;
    }
    const pick = best as { i: number; c: CityScore; s: ReturnType<typeof over> } | null;
    if (!pick) break;
    swaps.push({ out: stops[pick.i]!, in: pick.c, before: now.worst, after: pick.s.worst });
    stops = stops.map((x, j) => (j === pick.i ? pick.c : x));
  }
  return { stops, swaps };
}

/** The better of two bookings by check_plan: fewer objections wins; on a tie the earlier one stands. */
export const worstLeg = (o: Objection[]) => Math.max(0, ...o.map((x) => x.km ?? 0));
/** b beats a only with fewer objections and a worst leg no longer than a's (or within the cap): trading a 1,895 km
 *  leg for a 3,298 km one is never progress, however few objections are left (Oct 30, Sierra Ferrell nk53jakf3w). */
export const better = (a: { objections: Objection[] }, b: { objections: Objection[] }) =>
  b.objections.length < a.objections.length && worstLeg(b.objections) <= Math.max(worstLeg(a.objections), MAX_LEG_KM);

/** What changed between two bookings, as "proposed → objected → chose" rows for the call sheet. */
export function bookingSwaps(prev: BookStop[], next: BookStop[], objections: Objection[], name: (id: string) => string, roomName: (city: string, id: string) => string): NonNullable<LogLine["swaps"]> {
  const objected = (id: string, rules?: Objection["rule"][]) => objections.find((o) => o.city_id === id && (!rules || rules.includes(o.rule)))?.short;
  const gone = prev.filter((p) => !next.some((x) => x.city_id === p.city_id));
  const came = next.filter((x) => !prev.some((p) => p.city_id === x.city_id));
  const rows: NonNullable<LogLine["swaps"]> = [];
  gone.forEach((g, i) => {
    const c = came[i];
    rows.push({ proposed: name(g.city_id), objection: objected(g.city_id) ?? (c && objected(c.city_id, ["anchor", "fan", "home"])) ?? "the agent's own change", chose: c ? name(c.city_id) : "dropped" });
  });
  for (const c of came.slice(gone.length)) rows.push({ proposed: "no stop", objection: objected(c.city_id, ["anchor", "fan", "home"]) ?? objections.find((o) => o.rule === "count")?.short ?? "the agent's own change", chose: name(c.city_id) });
  for (const x of next) {
    const p = prev.find((y) => y.city_id === x.city_id);
    if (p && p.room_id !== x.room_id) rows.push({ proposed: `${roomName(x.city_id, p.room_id)}, ${name(x.city_id)}`, objection: objected(x.city_id, ["room"]) ?? "the agent's own change", chose: roomName(x.city_id, x.room_id) });
  }
  return rows;
}

/** Stops whose city or room differ between two bookings. */
const changedStops = (a: BookStop[], b: BookStop[]) => b.filter((x) => !a.some((y) => y.city_id === x.city_id && y.room_id === x.room_id)).length;

function revisePrompt(objections: Objection[], shows: number, others: CityScore[], scouted: { city_id: string }[] = [], setAside: string[] = []): string {
  return `${setAside.length ? `${setAside.join("\n")}\n\n` : ""}check_plan ran the tour's rules over your booking and objects to ${objections.length === 1 ? "one thing" : `${objections.length} things`}:\n${objections.map((o) => `- ${o.text}`).join("\n")}\n\n${scouted.length ? `Scouting results for the cities the check asks you to book (use these room_ids):\n${JSON.stringify(scouted)}\n\n` : ""}${others.length ? `Other candidate cities (not scouted yet; their rooms are looked up if you book one): ${others.map((c) => `${c.marketId} (${c.name}, fan #${c.rank})`).join(", ")}.\n\n` : ""}You also have one tool, scout_city: list in "scout" up to ${SCOUT_PER_ROUND} city_ids from the candidates whose rooms you haven't seen (or an empty list). Routed looks each one up on Qloo right away (the rooms these fans go to, measured against the crowd, and the support acts there); if you book a city you asked to scout, give any room_id and the size rule books the best room there. Its rooms are shown to you next round.

Re-book exactly ${shows} stops in the same JSON shape. Keep every stop the check didn't object to; change only what an objection names, using city_ids from the candidates and room_ids from that city's rooms. Write each "why" for the stop as you now book it.`;
}

/* ───────────────────────── the city rules ───────────────────────── */

export type SettleEvent =
  | { t: "fill"; cities: CityScore[] }
  | { t: "swap"; out: CityScore; in: CityScore; km: number; reason?: "leg" | "km-per-show" | "country" }
  | { t: "anchor"; anchor: CityScore; out: CityScore[]; close: boolean }
  | { t: "home"; home: CityScore; out: CityScore[] }
  | { t: "fan"; city: CityScore; out: CityScore[]; bridge?: CityScore }
  | { t: "no-fan"; city: CityScore }
  | { t: "bridge"; city: CityScore; out: CityScore[]; from: CityScore; to: CityScore; km: number }
  | { t: "no-home"; home: CityScore; reason: string };

/**
 * The rules that settle a tour's cities after the agent's booking (or from nothing, for the fixed plan and the
 * size-only plan): fill from the ranking, skipping cities with no rooms (in a small region the radius clause can
 * use up the first candidates, so the fill looks down to POOL_SIZE); the leg rule (an order with no leg between
 * two shows over the cap is searched first; only when none exists are the groups that can't reach each other
 * pulled into the strongest one, and any long leg left broken by a swap); the anchor rule (a major market in the
 * top ten is always on the tour when the route can reach it; the smaller city inside its radius gives way); the
 * hometown rule (a starting city in the artist's top HOME_RANK opens the run, and no rule swaps it out); and, in
 * mainland Europe, the country cap. `rank` is what the rules weigh a city by; the hometown is judged on the fan map.
 */
export async function settleCities<T extends { score: CityScore }>(o: {
  chosen: T[];
  ranking: CityScore[];
  candidates: number;
  shows: number;
  from: { lat: number; lon: number };
  radius: number;
  usable: (id: string) => Promise<boolean>;
  make: (c: CityScore) => T;
  rank?: (c: CityScore) => number;
  region?: RegionId;
  /** The leg cap (road km); MAX_LEG_KM unless a tour asks for less. */
  legCap?: number;
  /** Cities kept like anchors (Qloo's top fan cities): added when the run can reach them, never swapped out. */
  protect?: (c: CityScore) => boolean;
  on?: (e: SettleEvent) => void;
}): Promise<{ stops: T[]; homeId?: string; tradeOff?: string }> {
  const { shows, radius } = o;
  const max = o.legCap ?? MAX_LEG_KM;
  const chosen = [...o.chosen];
  const allById = new Map(o.ranking.map((c) => [c.marketId, c]));
  for (const c of chosen) if (!allById.has(c.score.marketId)) allById.set(c.score.marketId, c.score);
  const rankOf = o.rank ?? ((c: CityScore) => c.rank);
  const clash = (a: CityScore, b: CityScore) => tooClose(placed(a), placed(b), radius);

  const deep = o.ranking.slice(0, Math.max(o.candidates, POOL_SIZE));
  const filled: CityScore[] = [];
  for (const score of deep) {
    if (chosen.length >= shows) break;
    if (chosen.some((x) => x.score.marketId === score.marketId || clash(x.score, score))) continue;
    if (!(await o.usable(score.marketId))) continue;
    chosen.push(o.make(score));
    filled.push(score);
  }
  o.on?.({ t: "fill", cities: filled });

  const asStop = (c: CityScore) => ({ ...c, id: c.marketId, pop: popOf(c.marketId), rank: rankOf(c) });
  /** The anchor and hometown rules read the artist's fan map, whatever the plan is weighed by. */
  const onFanMap = (c: CityScore) => ({ ...asStop(c), rank: c.rank });
  const usable = (c: { id: string }) => o.usable(c.id);
  const pool = o.ranking.slice(0, POOL_SIZE);
  const homeId = homeCity(o.from, deep.map(onFanMap))?.id;
  const first = () => (homeId && chosen.some((c) => c.score.marketId === homeId) ? homeId : undefined);
  // The anchor and hometown rules read the fan map too: "a major market in the artist's top ten".
  const protect = (c: CityScore) => o.protect?.(c) ?? false;
  const keep = (c: { id: string; pop?: number }) => c.id === homeId || isAnchor({ rank: allById.get(c.id)?.rank ?? Infinity, pop: c.pop }) || protect(allById.get(c.id)!);
  let tradeOff: string | undefined;
  const rebuild = (stops: { id: string }[]) => {
    const was = new Map(chosen.map((c) => [c.score.marketId, c]));
    chosen.splice(0, chosen.length, ...stops.map((st) => was.get(st.id) ?? o.make(allById.get(st.id)!)));
  };
  /** Legs over the cap in the best order of these stops (the exact search, opening at the hometown). */
  const longCount = (list: CityScore[]) => longLegs(o.from, orderStops(o.from, list.map((x) => ({ ...x, id: x.marketId })), { max, first: homeId && list.some((x) => x.marketId === homeId) ? homeId : undefined }), max).length;
  const kept = (x: CityScore) => keep({ id: x.marketId, pop: popOf(x.marketId) });
  const apply = (swaps: { out: { id: string }; in: { id: string }; km: number; reason?: "leg" | "km-per-show" | "country" }[]) => {
    for (const sw of swaps) {
      const i = chosen.findIndex((c) => c.score.marketId === sw.out.id);
      if (i < 0) continue;
      chosen.splice(i, 1, o.make(allById.get(sw.in.id)!));
      o.on?.({ t: "swap", out: allById.get(sw.out.id)!, in: allById.get(sw.in.id)!, km: sw.km, reason: sw.reason });
    }
  };
  // A swap stands only when the run ends up with fewer legs over the cap than it started with, and then each swap
  // that the result doesn't need is undone, newest first, so the higher-ranked city keeps its place (Denver, fan #4,
  // was once swapped for Boulder, #7, and the leg stayed over the cap). Whatever is left is flagged.
  const legPass = async () => {
    const start = chosen.map((c) => c.score);
    const n0 = longCount(start);
    const legs = await repairLegs({ from: o.from, stops: start.map(asStop), pool: pool.map(asStop), usable, weight: (c) => 1 / Math.sqrt(c.rank), radius, max, keep, first: first() });
    let list = legs.stops.map((x) => allById.get(x.id)!);
    let kept = [...legs.swaps];
    if (!kept.length || longCount(list) >= n0) {
      list = start;
      kept = [];
    } else {
      for (const sw of [...kept].reverse()) {
        const at = list.findIndex((x) => x.marketId === sw.in.id);
        const back = allById.get(sw.out.id)!;
        if (at < 0 || list.some((x) => x.marketId === back.marketId || (x.marketId !== sw.in.id && clash(x, back)))) continue;
        const undone = list.map((x, i) => (i === at ? back : x));
        if (longCount(undone) <= longCount(list)) {
          list = undone;
          kept = kept.filter((k) => k !== sw);
        }
      }
    }
    for (const sw of kept) o.on?.({ t: "swap", out: allById.get(sw.out.id)!, in: allById.get(sw.in.id)!, km: sw.km, reason: sw.reason });
    rebuild(list.map((x) => ({ id: x.marketId })));
    if (kept.length) tradeOff = describeTradeOff(o.from, start.map(asStop), list.map(asStop), { max, first: first() }).text;
    if (o.region === "eu") apply((await capCountries({ from: o.from, stops: chosen.map((c) => asStop(c.score)), pool: pool.map(asStop), usable, radius, max, keep, first: first() })).swaps);
  };
  await legPass();

  const anchored = await keepAnchors(chosen.map((c) => onFanMap(c.score)), deep.map(onFanMap), shows, usable, radius, max);
  for (const { anchor, out } of anchored.added) o.on?.({ t: "anchor", anchor: allById.get(anchor.id)!, out: out.map((x) => allById.get(x.id)!), close: out.some((x) => tooClose(x, anchor, radius)) });
  if (anchored.added.length) rebuild(anchored.stops);

  // The fan anchors: each protected city comes in. A stop inside its radius gives way; when the run is full, so does
  // the weakest stop no rule keeps whose going leaves the fewest legs over the cap, so a bridge city (Salt Lake City
  // between Denver and Portland) is never the one dropped. When no such choice keeps every leg legal, one more stop
  // gives way to a bridge: a city that closes the leg, from inside the fan cap first, then past it (that is what a
  // city past the cap is for). A fan city no route can reach without a leg over the cap stays off, and says so.
  let fans = 0;
  const order = new Map(o.ranking.map((c, i) => [c.marketId, i]));
  const weakestFirst = (a: CityScore, b: CityScore) => (order.get(b.marketId) ?? 1e9) - (order.get(a.marketId) ?? 1e9);
  for (const f of deep.filter(protect)) {
    if (chosen.some((x) => x.score.marketId === f.marketId)) continue;
    const base = chosen.map((x) => x.score);
    const near = base.filter((x) => clash(x, f));
    if (near.some(kept)) continue;
    if (!(await o.usable(f.marketId))) continue;
    const baseN = longCount(base);
    const rest = base.filter((x) => !near.includes(x));
    const free = rest.filter((x) => !kept(x)).sort(weakestFirst);
    type Option = { gone: CityScore[]; list: CityScore[]; n: number; bridge?: CityScore };
    const options: Option[] = rest.length + 1 > shows ? free.map((g) => ({ gone: [...near, g], list: [...rest.filter((x) => x !== g), f], n: 0 })) : [{ gone: near, list: [...rest, f], n: 0 }];
    if (!options.length) continue;
    for (const opt of options) opt.n = longCount(opt.list);
    let best = options.reduce((a, b) => (b.n < a.n ? b : a));
    if (best.n > baseN) {
      let found: Option | undefined;
      let tries = 0;
      for (const b of o.ranking) {
        if (tries >= BRIDGE_TRIES) break;
        if (b.marketId === f.marketId || best.list.some((x) => x.marketId === b.marketId || clash(x, b)) || best.gone.includes(b) || roadKm(b, f) > max) continue;
        const out = best.list.length >= shows ? best.list.filter((x) => x !== f && !kept(x)).sort(weakestFirst)[0] : undefined;
        if (best.list.length >= shows && !out) break;
        const list = [...best.list.filter((x) => x !== out), b];
        const n = longCount(list);
        if (n > baseN) continue;
        tries++;
        if (!(await o.usable(b.marketId))) continue;
        found = { gone: out ? [...best.gone, out] : best.gone, list, n, bridge: b };
        break;
      }
      if (!found) {
        o.on?.({ t: "no-fan", city: f });
        continue;
      }
      best = found;
    }
    rebuild(best.list.map((x) => ({ id: x.marketId })));
    // A stop freed by the radius clause is refilled, but never with a city that lengthens a leg over the cap.
    for (const score of deep) {
      if (chosen.length >= shows) break;
      if (best.gone.includes(score) || chosen.some((x) => x.score.marketId === score.marketId || clash(x.score, score))) continue;
      if (longCount([...chosen.map((x) => x.score), score]) > best.n) continue;
      if (await o.usable(score.marketId)) chosen.push(o.make(score));
    }
    o.on?.({ t: "fan", city: f, out: best.gone, ...(best.bridge ? { bridge: best.bridge } : {}) });
    fans++;
  }

  // The hometown doesn't push out a city the anchor or fan rule keeps inside its radius.
  const homeCityScore = homeId ? allById.get(homeId) : undefined;
  const homeBlocked = Boolean(homeCityScore && chosen.some((x) => x.score.marketId !== homeId && kept(x.score) && clash(x.score, homeCityScore)));
  const homed = homeBlocked ? { stops: [], home: null, out: [], added: false } : await keepHome({ from: o.from, stops: chosen.map((c) => onFanMap(c.score)), ranked: deep.map(onFanMap), shows, usable, radius, max });
  if (homed.added && homed.home) {
    o.on?.({ t: "home", home: allById.get(homed.home.id)!, out: homed.out.map((x) => allById.get(x.id)!) });
    rebuild(homed.stops);
  } else if (homed.home && homed.reason) o.on?.({ t: "no-home", home: allById.get(homed.home.id)!, reason: homed.reason });
  if (anchored.added.length || fans || homed.added) await legPass();

  // Bridges: a leg still over the cap after the leg rule (Denver to Portland, 1,895 km) gets a city within the cap of
  // both ends, looked up even if no rule has scouted it yet: from the leg rule's pool, the fan cap's cities first, then
  // past it (closing a leg is what a city past the cap is for), each by fan rank, BRIDGE_TRIES room lookups at most. The weakest stop no
  // rule keeps gives way, chosen as in the fan step so no other leg goes over; a bridge stands only if it removes a
  // long leg.
  const tried = new Set<string>();
  let lookups = 0;
  for (let round = 0; round < shows && lookups < BRIDGE_TRIES; round++) {
    const list = chosen.map((c) => c.score);
    const now = longCount(list);
    if (!now) break;
    const home = homeId && list.some((x) => x.marketId === homeId) ? homeId : undefined;
    const ordered = orderStops(o.from, list.map((x) => ({ ...x, id: x.marketId })), { max, first: home });
    const leg = longLegs(o.from, ordered, max)[0]!;
    const a = ordered[leg.index - 1]!, b = ordered[leg.index]!;
    // From the leg rule's pool, by the plan's own weight: for the agent's plan the fan cap first, then fan rank; for
    // the size-only plan, size.
    const near = pool
      .filter((c) => !tried.has(c.marketId) && !list.some((x) => x.marketId === c.marketId || clash(x, c)) && roadKm(c, a) <= max && roadKm(c, b) <= max)
      .sort((x, y) => (o.protect ? Number(!inFanCap(x)) - Number(!inFanCap(y)) || x.rank - y.rank : rankOf(x) - rankOf(y)));
    let bridged = false;
    for (const c of near) {
      if (lookups >= BRIDGE_TRIES) break;
      const options = list.length >= shows ? list.filter((x) => !kept(x)).sort(weakestFirst).map((g) => ({ g, l: [...list.filter((x) => x !== g), c] })) : [{ g: undefined as CityScore | undefined, l: [...list, c] }];
      let best: { g?: CityScore; l: CityScore[]; n: number } | undefined;
      for (const opt of options) {
        const n = longCount(opt.l);
        if (n < now && (!best || n < best.n)) best = { ...opt, n };
      }
      if (!best) continue;
      tried.add(c.marketId);
      lookups++;
      if (!(await o.usable(c.marketId))) continue;
      rebuild(best.l.map((x) => ({ id: x.marketId })));
      o.on?.({ t: "bridge", city: c, out: best.g ? [best.g] : [], from: allById.get(a.marketId) ?? a, to: allById.get(b.marketId) ?? b, km: leg.km });
      bridged = true;
      break;
    }
    if (!bridged) break;
  }
  return { stops: chosen, homeId: first(), tradeOff };
}

/**
 * The counterfactual (C2c): the same city rules on city size alone. The region's markets biggest first, no
 * model and no Qloo call: a city counts as having rooms unless this run already looked and found none.
 */
export async function populationPlan(o: { cities: CityScore[]; region: RegionId; shows: number; from: { lat: number; lon: number }; usable: (id: string) => boolean }): Promise<string[]> {
  const fan = new Map(o.cities.map((c) => [c.marketId, c]));
  const size = sizeRanks(o.region);
  const ranking: CityScore[] = populationRanking(o.region).map((id) => {
    const known = fan.get(id);
    if (known) return known;
    const m = marketById(id)!;
    return { marketId: id, name: m.name, label: marketLabel(m), lat: m.lat, lon: m.lon, affinity: 0, tiles: 0, rank: o.cities.length + 1 };
  });
  const out = await settleCities({ chosen: [], ranking, candidates: Math.max(o.shows * 2 + 4, 16), shows: o.shows, from: o.from, radius: radiusFor(o.region), region: o.region, usable: async (id) => o.usable(id), make: (score) => ({ score }), rank: (c) => size.get(c.marketId) ?? ranking.length });
  return out.stops.map((c) => c.score.marketId);
}

/* ───────────────────────── the agent ───────────────────────── */

export async function planTour(
  opts: { artist: Artist; audience: Audience; cities: CityScore[]; from: { lat: number; lon: number; label: string }; region?: RegionId; shows: number; draw?: number; useModel: boolean; log: Log; /** Epoch ms by which the agent's model calls must be done (run.ts gives planning a share of the run). */ deadline?: number; /** Least time worth starting a model call with (tests shorten it). */ minCallMs?: number; /** Epoch ms after which no capacity or Wikidata lookup starts (run.ts: the run's time budget). */ lookupsUntil?: number },
  deps: PlanDeps,
): Promise<PlanResult> {
  const { artist, shows, log, draw } = opts;
  const RADIUS_KM = radiusFor(opts.region);
  const left = () => (opts.deadline ?? Infinity) - Date.now();
  const minCall = opts.minCallMs ?? MIN_MODEL_MS;
  const ask: Ask = <T,>(o: Parameters<Ask>[0]) => inTime(deps.ask<T>({ ...o, timeoutMs: Math.max(1000, Math.min(o.timeoutMs ?? 30_000, left())) }), left());

  // The blend (C2a): the cities in the order that beat city size alone on real tours. Qloo's own top few stay in
  // view, so the agent always sees where fans over-index most, ranks side by side.
  // The fan cap: only cities in Qloo's top FAN_CAP (or a major market in its top ten) are candidates when they can
  // fill the run; past it, a city only closes a leg. Qloo's top FAN_KEEP fan cities are kept like anchors.
  const blend = opts.region ? blendOrder(opts.cities, opts.region) : null;
  const blended = blend?.ordered ?? opts.cities;
  const within = blended.filter(inFanCap);
  const capped = within.length >= shows + 3;
  const cities = [...within, ...blended.filter((c) => !inFanCap(c))];
  const want = Math.max(shows * 2 + 4, 16);
  const topBlend = (capped ? within : cities).slice(0, want);
  const candidates = [...topBlend, ...opts.cities.slice(0, QLOO_TOP_SHOWN).filter((c) => !topBlend.includes(c))];
  const mustKeep = new Set(opts.cities.filter((c) => c.rank <= FAN_KEEP).map((c) => c.marketId));
  const lifted = blended.slice(0, want).filter((c) => !inFanCap(c));
  if (capped && lifted.length) log({ kind: "rule", text: `Only Qloo's top ${FAN_CAP} fan cities are candidates: a city further down the fan map is booked only to close a leg, however big it is.`, result: `Left out though city size lifts them: ${lifted.slice(0, 6).map((c) => `${c.name} (fan #${c.rank})`).join(", ")}` });
  log({ kind: "rule", text: `Qloo's ${FAN_KEEP} strongest fan cities are kept on the tour like major markets, whatever their size.`, result: opts.cities.filter((c) => mustKeep.has(c.marketId)).map((c) => `${c.name} (fan #${c.rank})`).join(", ") });
  if (blend) log({ kind: "rule", text: "Ordered the cities by fan rank weighed against city size: each city's place on Qloo's heatmap averaged with its place by metro population, the ranking that found more of the real tours than size alone.", result: cities.slice(0, 5).map((c) => `${c.name} (fan #${c.rank}, size #${blend.ranks.pop.get(c.marketId) ?? "–"})`).join(", ") });

  const byId = new Map(candidates.map((c) => [c.marketId, c]));
  const allById = new Map(cities.map((c) => [c.marketId, c]));
  const rooms = new Map<string, Room[]>();
  const openers = new Map<string, Opener[]>();
  const roomsP = new Map<string, Promise<Room[]>>();
  const openersP = new Map<string, Promise<Opener[]>>();
  const getRooms = (id: string) => {
    if (!roomsP.has(id)) roomsP.set(id, deps.lookUpRooms(artist, id, log, draw).catch(() => [] as Room[]).then((r) => (rooms.set(id, r), r)));
    return roomsP.get(id)!;
  };
  const getOpeners = (id: string) => {
    if (!openersP.has(id)) openersP.set(id, deps.lookUpOpeners(artist, id, log).catch(() => [] as Opener[]).then((o) => (openers.set(id, o), o)));
    return openersP.get(id)!;
  };

  /** Scout a city: the rooms these fans go to and the openers who share them, from Qloo. */
  const scout = async (id: string) => {
    await Promise.all([getRooms(id), getOpeners(id)]);
  };
  /** A room's capacity: Wikidata, then the web (a search costs a credit, so only for rooms about to be booked). */
  const measured = new Set<string>();
  let outOfTime = false;
  /** Measuring before the book call gets its own share of the run (Ghost's spent 113 s of 242 there, Oct 26); what
   *  it doesn't reach is measured after booking, for the rooms the agent books. Set when the measuring starts. */
  let premeasureUntil = Infinity;
  const inTimeForLookups = () => {
    if (Date.now() < (opts.lookupsUntil ?? Infinity)) return true;
    if (!outOfTime) log({ kind: "rule", text: "The run's time for capacity lookups is used up, so the rooms not yet measured stay unmeasured and their sheets say to ask the room.", failed: true });
    outOfTime = true;
    return false;
  };
  /**
   * A lookup that hasn't answered by `until` (the run's budget, or the measuring before booking's own share) is left:
   * the room stays unmeasured this run, and the answer, when it comes, is remembered for the next (lib/web.ts).
   */
  const measure = async (room: Room, city: string, until = opts.lookupsUntil ?? Infinity) => {
    if (room.capacity !== undefined || measured.has(room.id)) return;
    if (!inTimeForLookups()) return;
    measured.add(room.id);
    const cap = await inTime(deps.roomCapacity(room, city), Math.min(until, opts.lookupsUntil ?? Infinity) - Date.now()).catch(() => null);
    if (cap) room.capacity = cap;
    log({ kind: "web", text: `How many does ${room.name} hold?`, result: cap ? `${n(cap.value)}, per ${host(cap.source)}` : "Not found; ask the room." });
  };
  /**
   * Whether a room is worth a lookup at this crowd: from 3,000 up, not a room whose name or tags say small (a café,
   * a variety theatre's bar, a club) and not one the name rules already rule out. Ghost's 8,000 once spent 10 s a
   * room measuring Marula Café and CLAP Mataró.
   */
  const worthMeasuring = (r: Room) => !draw || draw < BIG_ROOM_DRAW || (sizePrior(r) !== "small" && roomNameOk(r.name, draw));
  /** Measures rooms in order, MEASURE_BATCH at a time, stopping after the batch that finds a close fit (85–130%):
   *  a loose fit or one the fans sell out doesn't stop it, so a closer room can still turn up. */
  const measureInOrder = async (order: Room[], city: string, until?: number) => {
    for (let i = 0; i < order.length; i += MEASURE_BATCH) {
      if (until !== undefined && Date.now() >= until) break;
      const batch = order.slice(i, i + MEASURE_BATCH);
      await Promise.all(batch.map((r) => measure(r, city, until)));
      if (batch.some((r) => roomFit(r, draw) === "close") || outOfTime) break;
    }
  };
  /** Before booking: the rooms the agent named, then the likeliest of the rest in the order the room rule measures
   *  them, until one is a close fit. */
  const premeasure = async (id: string) => {
    const c = allById.get(id) ?? byId.get(id);
    if (!draw || !c) return;
    const all = rooms.get(id) ?? [];
    const order = [...all.filter((r) => r.origin === "agent"), ...candidatesBySize(all.filter((r) => r.origin !== "agent" && worthMeasuring(r)), draw).slice(0, PRE_MEASURE)];
    await measureInOrder(order, c.label, premeasureUntil);
  };

  /**
   * The agent's room names, each looked for on Qloo in its city (one place search each, NAMED_SEARCHES a tour at
   * most), then scored for this artist's fans in one call. A found room joins the city's list in fan-affinity order
   * and keeps its Qloo id; a name Qloo can't find there is dropped and said so. A name already on Qloo's list costs
   * nothing.
   */
  const addNamedRooms = async (named: { id: string; names: string[] }[]) => {
    const t = Date.now();
    let searches = 0;
    const found: { id: string; room: Room; asked: string }[] = [];
    const missed: string[] = [];
    const already: string[] = [];
    await Promise.all(
      named.map(async ({ id, names }) => {
        const list = rooms.get(id) ?? [];
        const city = allById.get(id)?.name ?? id;
        const place = placeWords(marketById(id));
        for (const name of names) {
          if (list.some((r) => roomNameMatches(name, r.name, place))) {
            already.push(`${name} (${city})`);
            continue;
          }
          if (searches >= NAMED_SEARCHES) break;
          searches++;
          let failed = false;
          let why = "";
          const r = await deps.findPlace!(artist, name, id, draw, (w) => (why = w)).catch(() => ((failed = true), null));
          if (failed) {
            missed.push(`${name} in ${city} (Qloo didn't answer)`);
            log({ kind: "qloo", text: `Couldn't look up ${name} in ${city}: Qloo didn't answer.`, failed: true });
            continue;
          }
          if (!r || !roomNameMatches(name, r.name, place)) {
            missed.push(`${name} in ${city}`);
            log({ kind: "qloo", text: `The agent suggested ${name} in ${city}; Qloo's place search didn't return it there, so it isn't booked.`, ...(why ? { result: why } : {}) });
            continue;
          }
          if (list.some((x) => x.id === r.id) || found.some((f) => f.room.id === r.id)) {
            already.push(`${name} (${city})`);
            continue;
          }
          found.push({ id, room: { ...r, origin: "agent" }, asked: name });
        }
      }),
    );
    if (found.length && deps.scoreRooms) {
      const aff = await deps.scoreRooms(artist, found.map((f) => f.room.id)).catch(() => new Map<string, number>());
      for (const f of found) if (aff.has(f.room.id)) f.room.affinity = aff.get(f.room.id);
    }
    for (const f of found) {
      const list = rooms.get(f.id) ?? [];
      if (!rooms.has(f.id)) rooms.set(f.id, list);
      // In fan-affinity order among Qloo's own rooms (the list arrives strongest first); unscored goes last.
      const at = f.room.affinity === undefined ? list.length : list.findIndex((x) => (x.affinity ?? 0) < f.room.affinity!);
      list.splice(at < 0 ? list.length : at, 0, f.room);
    }
    log({ kind: "qloo", text: `Looked up the rooms the agent named on Qloo, in their cities.`, result: `${found.length} found and added: ${found.map((f) => `${f.room.name} (${allById.get(f.id)?.name ?? f.id})`).join(", ") || "none"}${already.length ? `; already on Qloo's list: ${already.join(", ")}` : ""}${missed.length ? `; not found: ${missed.join(", ")}` : ""}`, ms: Date.now() - t });
  };

  let booked: BookStop[] | null = null;
  let model: string | undefined;
  let bookMessages: Msg[] = [];
  let check: AgentCheck | undefined;
  let extra = 0;

  if (opts.useModel) {
    try {
      if (left() < minCall) throw new Error("no time left for the agent");
      // 1. Shortlist.
      const t1 = Date.now();
      const short = await ask<{ cities: { city_id: string; why: string; rooms?: string[] }[]; alternates: string[] }>({
        name: "shortlist",
        schema: deps.findPlace ? LIVE_SHORTLIST_SCHEMA : SHORTLIST_SCHEMA,
        maxTokens: 6000,
        timeoutMs: 90_000,
        messages: [
          { role: "system", content: role(artist.name) },
          {
            role: "user",
            content: `${shortlistPrompt({
              brief: brief(artist, opts.audience),
              from: opts.from,
              shows,
              draw,
              source: blend ? `Candidate cities for ${artist.name}, in blend order: Qloo's fan rank (where these fans over-index) averaged with size rank (metro population), the ranking that beat city size alone on real tours` : `Candidate cities from Qloo's heatmap for ${artist.name}, strongest first`,
              table: table(candidates, opts.from, RADIUS_KM, blend?.ranks, mustKeep),
              prefer: blend ? "always including the cities marked MUST KEEP (the artist's strongest fan cities on Qloo), then weighing fan rank against city size (the blend order is a good guide; a city high on Qloo's fan rank is worth a stop even when it is small)" : "preferring stronger cities",
            })}${deps.findPlace ? `\n\nFor each shortlisted city, also give "rooms": up to ${NAMED_PER_CITY} music rooms there you would book for ${artist.name}${draw ? ` with a crowd of about ${draw}` : ""} (the venue's name only, as it is usually written; a theatre, hall, ballroom or arena that holds about that many). Qloo looks each one up; a name it can't find is dropped.` : ""}`,
          },
        ],
      });
      model = short.model;
      const shortlist = [...new Set((short.data.cities ?? []).map((c) => c.city_id).filter((id) => byId.has(id)))];
      const alternates = [...new Set((short.data.alternates ?? []).filter((id) => byId.has(id) && !shortlist.includes(id)))].slice(0, 3);
      if (process.env.ROUTED_DEBUG) console.log("[plan] shortlist", shortlist, alternates);
      log({ kind: "model", text: `Shortlisted ${shortlist.length} cities and ${alternates.length} alternates from Qloo's ranking.`, result: [...shortlist.map((id) => byId.get(id)!.name), ...(alternates.length ? [`alternates: ${alternates.map((id) => byId.get(id)!.name).join(", ")}`] : [])].join(", "), ms: Date.now() - t1 });
      if (!shortlist.length) throw new Error("empty shortlist");

      // 2. Scout every shortlisted city and alternate, then measure the shortlisted cities' likeliest rooms, so
      //    the agent books knowing what each holds (the same rooms the room rule would measure after booking).
      // The must-keep cities are scouted even when the shortlist left one out, so the agent can book it.
      const kept = [...mustKeep].filter((id) => byId.has(id) && !shortlist.includes(id) && !alternates.includes(id));
      await Promise.all([...shortlist, ...alternates, ...kept].map(scout));
      // The rooms the agent named, found on Qloo and merged into each city's candidates (C: Qloo's own room list
      // missed the real tour's room in most cities, Oct 26). Size decides first; fan affinity orders within a size.
      const named = (short.data.cities ?? []).filter((c) => shortlist.includes(c.city_id)).map((c) => ({ id: c.city_id, names: [...new Set((c.rooms ?? []).map((x) => x.trim()).filter(Boolean))].slice(0, NAMED_PER_CITY) }));
      if (deps.findPlace && named.some((c) => c.names.length)) await addNamedRooms(named);
      if (draw) {
        const before = measured.size;
        premeasureUntil = Date.now() + PRE_MEASURE_MS;
        await Promise.all([...shortlist, ...kept].map(premeasure));
        const fitting = shortlist.filter((id) => (rooms.get(id) ?? []).some((r) => fit(r, draw) === "fits")).length;
        log({ kind: "rule", text: `Measured the likeliest rooms in the ${shortlist.length} shortlisted cities before booking, so the agent books knowing what each holds.`, result: `${measured.size - before} rooms checked; a room confirmed to fit about ${n(draw)} in ${fitting} of ${shortlist.length} cities` });
      }

      // 3. Book.
      const t3 = Date.now();
      const evidence = [...shortlist, ...alternates, ...kept].map((id) => ({
        city_id: id,
        city: byId.get(id)!.label,
        heatmap_rank: byId.get(id)!.rank,
        alternate: alternates.includes(id),
        ...(mustKeep.has(id) ? { must_keep: true } : {}),
        rooms: compactRooms(rooms.get(id) ?? [], draw),
        openers: compactOpeners(openers.get(id) ?? []),
      }));
      bookMessages = [
        { role: "system", content: role(artist.name) },
        {
          role: "user",
          content: `${brief(artist, opts.audience)}\nShows wanted: ${shows}.${draw ? ` Usual crowd: about ${draw}. Each room shows its capacity where one was found and its size against this crowd ("fits", "too small", "too big", or "unknown" when no capacity was found): book a room that fits wherever a city has one. When a capacity is unknown, a room's popularity is a rough guide to its size, so prefer well-known rooms over tiny ones for a crowd this size.` : " Crowd size unknown: a room's popularity is a rough guide to its size."}\n\nScouting results (rooms and openers from Qloo for ${artist.name}'s fans):\n${JSON.stringify(evidence)}\n\nBook exactly ${shows} stops. For each: city_id, room_id from that city's rooms (a real music room: club, hall or theatre, not a festival, gallery or restaurant), opener_id: one support act for the whole run (it travels with the tour, as on a real tour), so use the same opener_id on every stop, choosing an artist that appears in several cities' openers and fits ${artist.name}'s genre, and "why": one natural sentence a manager would read, on why this city and this room, citing one or two figures (for example "Seattle is ${artist.name}'s #2 city on Qloo, and Barboza's crowd matches these fans at 84"). Don't list every field. Book every city marked must_keep (the artist's strongest fan cities on Qloo). Use an alternate city only when a shortlisted city has no room that fits.${draw ? " In each city, rule_pick marks the room the size rule would book (a measured fit always beats a room nobody could measure): book it unless another room that fits matches these fans better." : ""} After you book, check_plan runs the tour's rules over it (the ${RADIUS_KM} km radius clause, the ${n(MAX_LEG_KM)} km leg cap, room fit, major markets, the strongest fan cities) and sends back anything they object to.`,
        },
      ];
      const book = await ask<{ stops: BookStop[] }>({ name: "book", schema: BOOK_SCHEMA, maxTokens: 8000, timeoutMs: 120_000, messages: bookMessages });
      model = book.model;
      booked = book.data.stops ?? [];
      if (process.env.ROUTED_DEBUG) console.log("[plan] book", JSON.stringify(booked).slice(0, 1200));
      log({ kind: "model", text: `Booked ${booked.length} stops: a room in each, and one support act for the run.`, result: booked.map((s) => byId.get(s.city_id)?.name ?? s.city_id).join(", "), ms: Date.now() - t3 });
    } catch (e) {
      console.error("[plan] model failed, using the fixed plan", e);
      log({ kind: "model", text: "The agent model didn't answer in time, so the fixed plan takes over.", failed: true });
      booked = null;
      model = undefined;
    }
  }

  // 4. check_plan, and the agent's answer to it: at most MAX_REVISIONS rounds, each one strict-JSON call.
  if (booked) {
    const first = booked;
    const ctx = (): CheckContext => ({ byId, rooms, shows, draw, from: opts.from, radius: RADIUS_KM, mustKeep });
    const name = (id: string) => allById.get(id)?.name ?? byId.get(id)?.name ?? id;
    const roomName = (city: string, id: string) => rooms.get(city)?.find((r) => r.id === id)?.name ?? "an unlisted room";
    let objections = checkPlan(booked, ctx());
    const before = objections.length;
    log({ kind: "rule", text: objections.length ? `check_plan: ${objections.length === 1 ? "one objection" : `${objections.length} objections`} to the agent's booking, sent back to it.` : "check_plan: the agent's booking clears every rule (radius clause, leg cap, room fit, major markets).", result: objections.length ? objections.map((o) => `${o.city_id ? `${name(o.city_id)}: ` : ""}${o.short}`).join("; ") : undefined });
    let rounds = 0;
    const scoutedByAgent: string[] = [];
    // The best booking so far by check_plan. A re-booking replaces it only with fewer objections; otherwise it is set
    // aside, the agent is told why, and the next round starts from the best one again (Oct 29: re-booking rounds that
    // added objections, Alvvays 1 to 4, were kept).
    let best = { stops: booked, objections, round: 0 };
    const setAside: string[] = [];
    while (best.objections.length && rounds < MAX_REVISIONS && extra < EXTRA_CALLS) {
      booked = best.stops;
      objections = best.objections;
      if (left() < minCall) {
        log({ kind: "rule", text: "No time left for the agent to answer the check, so the rules settle what's left.", failed: true });
        break;
      }
      rounds++;
      extra++;
      const t = Date.now();
      // A city the check asks the agent to add (a hometown, an anchor, a fan city) is scouted first, so the agent can
      // book a real room there instead of inventing one (Turnstile's Baltimore, Oct 26).
      const asked = [...new Set(objections.filter((o) => o.city_id && ["home", "anchor", "fan"].includes(o.rule) && byId.has(o.city_id)).map((o) => o.city_id!))];
      await Promise.all(asked.map(async (id) => {
        await scout(id);
        await premeasure(id);
      }));
      const scouted = [...new Set([...asked, ...scoutedByAgent])].map((id) => ({ city_id: id, rooms: compactRooms(rooms.get(id) ?? [], draw), openers: compactOpeners(openers.get(id) ?? []) }));
      const others = candidates.filter((c) => !rooms.has(c.marketId)).slice(0, 12);
      const messages: Msg[] = [...bookMessages, { role: "assistant", content: JSON.stringify({ stops: booked }) }, { role: "user", content: revisePrompt(objections, shows, others, scouted, setAside) }];
      let next: BookStop[];
      try {
        const r = await ask<{ stops: BookStop[]; scout?: string[] }>({ name: "rebook", schema: REBOOK_SCHEMA, maxTokens: 8000, timeoutMs: 90_000, messages });
        model = r.model;
        next = r.data.stops ?? [];
        // scout_city: the agent's own Qloo lookups, at most SCOUT_PER_ROUND a round, cities it hasn't seen.
        const wanted = [...new Set((r.data.scout ?? []).filter((id) => byId.has(id) && !rooms.has(id)))].slice(0, SCOUT_PER_ROUND);
        if (wanted.length) {
          const ts = Date.now();
          await Promise.all(wanted.map(async (id) => {
            await scout(id);
            await premeasure(id);
          }));
          scoutedByAgent.push(...wanted);
          log({ kind: "qloo", text: `The agent asked to scout ${wanted.map(name).join(" and ")} before re-booking (scout_city, round ${rounds}).`, result: wanted.map((id) => `${name(id)}: ${(rooms.get(id) ?? []).length} rooms, ${(openers.get(id) ?? []).length} support acts`).join("; "), ms: Date.now() - ts });
        }
      } catch (e) {
        console.error("[plan] revision failed", e);
        log({ kind: "model", text: `The agent didn't answer the check (round ${rounds}), so the rules settle what's left.`, failed: true, ms: Date.now() - t });
        break;
      }
      // A candidate city the agent brings in gets its lookups (as a city the rules filled would) before the check.
      await Promise.all(next.filter((s) => byId.has(s.city_id)).map(async (s) => {
        await scout(s.city_id);
        await premeasure(s.city_id);
      }));
      // A city the agent asked to scout gets the size rule's room when the agent couldn't know its room ids.
      next = next.map((s) => {
        if (!scoutedByAgent.includes(s.city_id)) return s;
        const rs = rooms.get(s.city_id) ?? [];
        if (rs.some((x) => x.id === s.room_id)) return s;
        const pick = chooseRoom(rs, undefined, draw);
        return pick ? { ...s, room_id: pick.id } : s;
      });
      const swaps = bookingSwaps(booked, next, objections, name, roomName);
      const after = checkPlan(next, ctx());
      const kept = better(best, { objections: after });
      const was = best.objections.length;
      // A round no better as a whole may still hold changes that help on their own: keep those.
      const merged = kept ? null : keepHelpful(best.stops, next, (s) => checkPlan(s, ctx()), name);
      log({ kind: "model", text: `The agent re-booked after the check (round ${rounds} of ${MAX_REVISIONS}).`, result: `${swaps.length ? `${swaps.length} pick${swaps.length === 1 ? "" : "s"} changed` : "No pick changed"}; ${after.length ? `${after.length} objection${after.length === 1 ? "" : "s"} left: ${after.map((o) => `${o.city_id ? `${name(o.city_id)}: ` : ""}${o.short}`).join("; ")}` : "every rule clears"}${kept ? "" : merged ? `; as a whole no better than the ${was} before, so only the agent's changes that help on their own are kept (${merged.kept.join(", ")}), leaving ${merged.objections.length}` : `; that is no better than the ${was} before, so the earlier booking stands`}`, swaps, ms: Date.now() - t });
      if (kept) best = { stops: next, objections: after, round: rounds };
      else if (merged) best = { stops: merged.stops, objections: merged.objections, round: rounds };
      if (!kept) setAside.push(`Your round ${rounds} re-booking (${swaps.map((x) => `${x.proposed} to ${x.chose}`).join(", ") || "no change"}) left ${after.length} objection${after.length === 1 ? "" : "s"}, no fewer than the ${was} before${merged ? `; of it, ${merged.kept.join(" and ")} helped and ${merged.kept.length === 1 ? "is" : "are"} kept` : ", so it was set aside"}: fix what is still objected to below.`);
    }
    booked = best.stops;
    objections = best.objections;
    if (objections.length && rounds) log({ kind: "rule", text: `${objections.length === 1 ? "One objection still stands" : `${objections.length} objections still stand`} after the agent's ${rounds === 1 ? "revision" : `${rounds} revisions`} (the agent cleared ${before - objections.length} of ${before}), so the rules settle ${objections.length === 1 ? "it" : "them"}.` });
    else if (rounds) log({ kind: "rule", text: `The agent cleared all ${before} of check_plan's objections itself, in ${best.round === 1 ? "one round" : `${best.round} rounds`}.` });
    check = { before, after: objections.length, rounds, revised: changedStops(first, booked), ruled: 0, stops: 0 };
  }

  // Guard the model's answer: real candidates only, no duplicates, radius clause, rooms to book, the right count.
  type Chosen = { score: CityScore; why?: string; roomId?: string; openerId?: string };
  const clash = (a: CityScore, b: CityScore) => tooClose(placed(a), placed(b), RADIUS_KM);
  const chosen: Chosen[] = [];
  for (const s of booked ?? []) {
    const score = byId.get(s.city_id);
    if (!score || chosen.some((c) => c.score.marketId === score.marketId)) continue;
    if (chosen.some((c) => clash(c.score, score))) continue;
    if (!(await getRooms(score.marketId)).length) continue;
    chosen.push({ score, why: s.why, roomId: s.room_id, openerId: s.opener_id });
    if (chosen.length >= shows) break;
  }
  const planned = chosen.length ? "model" : "fixed";

  // The rules settle the cities: fill from the ranking (the whole plan when there's no model), the leg rule, the
  // anchor rule. Each change is on the call sheet.
  const before = chosen.length;
  const usable = async (id: string) => (await getRooms(id)).length > 0;
  const settled = await settleCities({
    chosen,
    ranking: cities,
    candidates: candidates.length,
    shows,
    from: opts.from,
    radius: RADIUS_KM,
    usable,
    make: (score) => ({ score }),
    region: opts.region,
    protect: (c) => mustKeep.has(c.marketId),
    on: (e) => {
      if (e.t === "fill") {
        if (planned === "fixed") log({ kind: "rule", text: `Fixed plan: the ${before + e.cities.length} ${blend ? "top cities in blend order (fan rank weighed against size)" : "strongest cities"} that clear the ${RADIUS_KM} km radius clause and have rooms.`, result: e.cities.map((c) => c.name).join(", ") });
        else if (e.cities.length) log({ kind: "rule", text: `The agent booked ${before} usable stops; the ranking filled the other ${e.cities.length}.`, result: e.cities.map((c) => c.name).join(", ") });
      } else if (e.t === "swap") {
        if (e.reason === "km-per-show") log({ kind: "rule", text: `${e.out.name} is far off the run, so ${e.in.name} (#${e.in.rank} on the fan map) takes its place and the van drives less per show.`, result: `${n(e.km)} km leg saved` });
        else if (e.reason === "country") log({ kind: "rule", text: `Too many dates in one country, so ${e.in.name} (#${e.in.rank} on the fan map) takes ${e.out.name}'s place.`, result: "No country gets more than about 40% of a mainland Europe run" });
        else log({ kind: "rule", text: `${e.out.name} would cost a ${n(e.km)} km leg with no show, so ${e.in.name} (#${e.in.rank} on the fan map) takes its place.`, result: `No order of the stops keeps every leg between shows under ${n(MAX_LEG_KM)} km, and a city with rooms can close it` });
      } else if (e.t === "home") {
        log({ kind: "rule", text: `${e.home.name} is where the tour starts and #${e.home.rank} on ${artist.name}'s fan map, so the run opens with a hometown show${e.out.length ? ` and ${e.out.map((x) => x.name).join(" and ")} give${e.out.length === 1 ? "s" : ""} way` : ""}.`, result: "No band routes past its hometown" });
      } else if (e.t === "fan") {
        log({ kind: "rule", text: `${e.city.name} is #${e.city.rank} on ${artist.name}'s fan map, one of the ${FAN_KEEP} strongest, so it stays on the tour${e.out.length ? ` and ${e.out.map((x) => x.name).join(" and ")} give${e.out.length === 1 ? "s" : ""} way` : ""}${e.bridge ? `; ${e.bridge.name} (fan #${e.bridge.rank}${e.bridge.rank > FAN_CAP ? ", past the fan cap" : ""}) comes in to keep every leg under ${n(MAX_LEG_KM)} km` : ""}.`, result: "A tour never drops the artist's strongest fan cities when the route can reach them, and never drops the city that bridges the route" });
      } else if (e.t === "bridge") {
        log({ kind: "rule", text: `${e.from.name} to ${e.to.name} is ${n(e.km)} km of road with no show, so ${e.city.name} (fan #${e.city.rank}${e.city.rank > FAN_CAP ? ", past the fan cap" : ""}) bridges it${e.out.length ? ` and ${e.out.map((x) => x.name).join(" and ")} give${e.out.length === 1 ? "s" : ""} way` : ""}.`, result: `No leg between shows over ${n(MAX_LEG_KM)} km` });
      } else if (e.t === "no-fan") {
        log({ kind: "rule", text: `${e.city.name} is #${e.city.rank} on ${artist.name}'s fan map, but no route reaches it without a leg over ${n(MAX_LEG_KM)} km, even with a bridge city, so it stays off this run.`, failed: true });
      } else if (e.t === "no-home") {
        log({ kind: "rule", text: `${e.home.name} is #${e.home.rank} on the fan map, but stays off the tour: ${e.reason}.` });
      } else {
        const { anchor, out } = e;
        log({ kind: "rule", text: `${anchor.name} is a major market and #${anchor.rank} on ${artist.name}'s fan map, so it stays on the tour${out.length ? ` and ${out.map((o) => o.name).join(" and ")} give${out.length === 1 ? "s" : ""} way` : ""}.`, result: e.close ? `${out.map((o) => o.name).join(" and ")} ${out.length === 1 ? "is" : "are"} inside the ${RADIUS_KM} km radius of ${anchor.name}` : `${anchor.name} added` });
      }
    },
  });
  chosen.splice(0, chosen.length, ...settled.stops);
  // The leg cap as a post-condition: any leg still over it is closed from cities already scouted (no Qloo call),
  // by swapping a stop for one that leaves less road over the cap, protected stops last.
  {
    const scouted = cities.filter((c) => (rooms.get(c.marketId)?.length ?? 0) > 0 && (!draw || roomCheck(rooms.get(c.marketId)!, undefined, draw).bookable));
    const fixed = enforceLegCap({ from: opts.from, stops: chosen.map((c) => c.score), pool: scouted, radius: RADIUS_KM, first: settled.homeId, keep: (c) => c.marketId === settled.homeId || mustKeep.has(c.marketId) });
    for (const sw of fixed.swaps) {
      const i = chosen.findIndex((c) => c.score.marketId === sw.out.marketId);
      if (i < 0) continue;
      chosen[i] = { score: sw.in };
      log({ kind: "rule", text: `${sw.out.name} left a leg over ${n(MAX_LEG_KM)} km, so ${sw.in.name} (#${sw.in.rank} on the fan map, already scouted) takes its place.`, result: `Longest leg ${n(sw.before)} km before, ${n(sw.after)} km after` });
    }
  }
  const leftover = longLegs(opts.from, orderStops(opts.from, chosen.map((c) => ({ ...c.score, id: c.score.marketId })), { max: MAX_LEG_KM, first: settled.homeId }), MAX_LEG_KM);
  if (leftover.length) log({ kind: "rule", text: `${leftover.length === 1 ? "One leg is" : `${leftover.length} legs are`} still over ${n(MAX_LEG_KM)} km: no scouted city with a room that fits closes ${leftover.length === 1 ? "it" : "them"} without breaking another rule, so the day sheet flags ${leftover.length === 1 ? "it" : "them"}.`, failed: true });

  // Every picked city gets its lookups, whatever the model skipped. With a known crowd the booked room's capacity
  // is checked, then the city's other rooms in order (best-known first for a big crowd, best-matched for a small
  // one) until one is a close fit, up to eight checks a city. The room is then chosen by rule: a known fit for one night,
  // else a known two-night stand, else a room whose capacity couldn't be found, and a known misfit only when
  // nothing else is left (and the sheet says so).
  // A city whose rooms can't take this crowd (rooms.ts roomCheck: only misfits, or nothing measurable for 3,000 or
  // more) gives way to the next ranked city that clears the radius, adds no long leg and has a bookable room.
  /**
   * A city with no one-night fit gets the rooms Wikidata lists there at the right size (P1083, 60–250% of the crowd,
   * in the booker's order), each looked up on Qloo by name: found, it joins the city's rooms with Wikidata's
   * capacity, its Qloo id and the fans' affinity; not found, it is never booked. At most 2 a city.
   */
  const addLadderRooms = async (score: CityScore, list: Room[]): Promise<number> => {
    if (!draw || !deps.ladderRooms || !deps.findPlace) return 0;
    // In the booker's order (a close fit, then one the fans sell out, then a loose fit), nearest the crowd within each.
    const grade = (l: LadderRoom) => roomGrade({ id: l.qid, name: l.name, tags: [], capacity: { value: l.capacity, source: "", quote: "" } }, draw);
    const place = placeWords(marketById(score.marketId));
    const all = await deps.ladderRooms(score.marketId, draw).catch(() => [] as LadderRoom[]);
    // A room already on the list that nobody could measure takes the number Wikidata has for it (Terminal 5).
    let measuredNow = 0;
    for (const x of list) {
      if (x.capacity) continue;
      const l = all.find((y) => roomNameMatches(y.name, x.name, place));
      if (!l) continue;
      x.capacity = { value: l.capacity, source: `https://www.wikidata.org/wiki/${l.qid}`, quote: `${l.name}${l.description ? `: ${l.description}` : ""}; maximum capacity ${n(l.capacity)} (Wikidata P1083)` };
      measuredNow++;
    }
    // In the booker's order (a close fit, then one the fans sell out, then a loose fit); within it, a room built for
    // music or the stage before a sports arena, then nearest the crowd.
    const rungs = all
      .filter((l) => !list.some((x) => roomNameMatches(l.name, x.name, place)))
      .sort((a, b) => grade(a) - grade(b) || Number(concertRoom(b)) - Number(concertRoom(a)) || Math.abs(Math.log(a.capacity / draw)) - Math.abs(Math.log(b.capacity / draw)))
      .slice(0, 2);
    const added: Room[] = [];
    for (const l of rungs) {
      const r = await deps.findPlace(artist, l.name, score.marketId, draw).catch(() => null);
      if (!r || list.some((x) => x.id === r.id)) {
        log({ kind: "qloo", text: `Wikidata lists ${l.name} in ${score.name} (holds ${n(l.capacity)}); Qloo's place search didn't return it there, so it isn't booked.` });
        continue;
      }
      added.push({ ...r, origin: "wikidata", capacity: { value: l.capacity, source: `https://www.wikidata.org/wiki/${l.qid}`, quote: `${l.name}${l.description ? `: ${l.description}` : ""}; maximum capacity ${n(l.capacity)} (Wikidata P1083)` } });
    }
    if (added.length && deps.scoreRooms) {
      const aff = await deps.scoreRooms(artist, added.map((x) => x.id)).catch(() => new Map<string, number>());
      for (const x of added) if (aff.has(x.id)) x.affinity = aff.get(x.id);
    }
    list.push(...added);
    if (measuredNow) log({ kind: "web", text: `Wikidata measured ${measuredNow === 1 ? "a room" : `${measuredNow} rooms`} on ${score.name}'s list that the first lookups couldn't.` });
    if (added.length) log({ kind: "qloo", text: `No room on Qloo's list for ${score.name} fits the crowd for one night, so the rooms Wikidata lists there at that size were looked up on Qloo.`, result: added.map((x) => `${x.name} (holds ${n(x.capacity!.value)})`).join(", ") });
    return added.length + measuredNow;
  };

  const pickFor = async (c: Chosen): Promise<{ pick: Pick; bookable: boolean; reason?: string }> => {
      const [r, o] = await Promise.all([getRooms(c.score.marketId), getOpeners(c.score.marketId)]);
      const city = c.score.label;
      // The agent's room is always measured; without one, the first room worth a lookup at this crowd.
      const first = r.find((x) => x.id === c.roomId) ?? r.find(worthMeasuring) ?? r[0];
      if (first) await measure(first, city);
      if (draw && first && roomFit(first, draw) !== "close") await measureInOrder(candidatesBySize(r.filter((x) => x !== first && worthMeasuring(x)), draw).slice(0, MEASURE_PER_CITY), city);
      let check = roomCheck(r, c.roomId ?? first?.id, draw);
      // No one-night fit on Qloo's list (only two nights, a reduced house, a short room, unmeasured rooms or misfits:
      // Ghost's Paris got a 32,000 arena for 8,000, Milan a 3,250 club): the city's Wikidata rooms of the right size,
      // each found on Qloo first. From a crowd of 1,000 up, or whenever nothing can take the crowd.
      if (draw && (!check.bookable || (draw >= LADDER_DRAW && !roomFit(check.room!, draw))) && inTimeForLookups() && (await addLadderRooms(c.score, r))) check = roomCheck(r, c.roomId ?? first?.id, draw);
      const room = check.room;
      const nights = room && twoNights(room, draw) && !r.some((x) => fit(x, draw) === "fits") ? 2 : 1;
      if (room && c.roomId && room.id !== c.roomId) {
        const was = r.find((x) => x.id === c.roomId);
        log({ kind: "rule", text: `${was?.name ?? "The agent's room"} ${was?.capacity ? `holds ${n(was.capacity.value)}, ${fitWord(was, draw)} for a crowd of about ${n(draw!)}${fit(was, draw) === "fits" && room.capacity ? `, and ${room.name} is closer` : ""}` : "couldn't be confirmed for the crowd"}, so ${c.score.name} gets ${room.name}.`, result: room.capacity ? `${room.name} holds ${n(room.capacity.value)}${nights === 2 ? ": two nights" : fit(room, draw) === "fits" ? "" : " (the nearest size that could be confirmed)"}` : `${room.name}: capacity not found, ask the room` });
      } else if (room && reducedHouse(room, draw) && !r.some((x) => fit(x, draw) === "fits")) {
        log({ kind: "rule", text: `${room.name} holds ${n(room.capacity!.value)}, more than the usual crowd of about ${n(draw!)}, and no room in ${c.score.name} was confirmed to fit, so the pitch asks for a reduced configuration.`, result: `Up to ${REDUCED_MAX} times the crowd can be booked that way` });
      } else if (nights === 2 && room) {
        log({ kind: "rule", text: `${room.name} holds ${n(room.capacity!.value)}, under the usual crowd of about ${n(draw!)}, and no room in ${c.score.name} was confirmed to fit, so it's two nights.`, result: `${n(room.capacity!.value * 2)} across both nights` });
      }
      return { pick: { marketId: c.score.marketId, rooms: r, roomId: room?.id, openers: o, openerId: o.some((x) => x.id === c.openerId) ? c.openerId : undefined, why: c.why, nights, modelRoomId: c.roomId, modelOpenerId: c.openerId }, bookable: check.bookable, reason: check.reason };
  };
  const results = await Promise.all(chosen.map(pickFor));
  const legsOver = (list: CityScore[]) => longLegs(opts.from, orderStops(opts.from, list.map((x) => ({ ...x, id: x.marketId })), { max: MAX_LEG_KM, first: settled.homeId }), MAX_LEG_KM).length;
  for (let i = 0; i < chosen.length; i++) {
    const res = results[i]!;
    if (res.bookable) continue;
    const was = chosen[i]!.score;
    const now = legsOver(chosen.map((x) => x.score));
    let tries = 0;
    let swapped = false;
    if (was.marketId !== settled.homeId && !mustKeep.has(was.marketId)) {
      for (const score of cities.slice(0, POOL_SIZE)) {
        if (tries >= ROOM_SWAP_TRIES) break;
        if (chosen.some((x) => x.score.marketId === score.marketId || (x !== chosen[i] && clash(x.score, score)))) continue;
        if (legsOver(chosen.map((x, j) => (j === i ? score : x.score))) > now) continue;
        tries++;
        const next = await pickFor({ score });
        if (!next.bookable) continue;
        log({ kind: "rule", text: `${was.name} has no room this crowd can be booked into (${res.reason}), so ${score.name} (#${score.rank} on the fan map) takes its place.`, result: `${score.name}: ${next.pick.rooms.find((x) => x.id === next.pick.roomId)?.name ?? "a room"}` });
        chosen[i] = { score };
        results[i] = next;
        swapped = true;
        break;
      }
    }
    if (!swapped) {
      res.pick.noRoom = res.reason ?? "no room found";
      log({ kind: "rule", text: `${was.name} has no room this crowd can be booked into (${res.reason}), and no city within reach has one, so the day sheet flags it: no room found.`, failed: true });
    }
  }
  const picks = results.map((x) => x.pick);

  // One support act for the whole run, travelling with the tour: the opener the agent picked most often.
  const support = pickSupport(picks, artist.popularity);
  const voted = pickSupport(picks);
  if (support && voted && voted.id !== support.id) log({ kind: "rule", text: `${voted.name} is nearly as big as ${artist.name} on Qloo, a co-headliner priced like one, so the support slot goes to ${support.name}.`, result: `A support act sits well below the headliner on Qloo's popularity (at least ${SUPPORT_RATIO} times further from the top)` });
  if (support) {
    for (const p of picks) {
      if (!p.openers.some((o) => o.id === support.id)) p.openers = [support, ...p.openers];
      p.openerId = support.id;
    }
    const votes = picks.filter((p) => p.modelOpenerId === support.id).length;
    log({ kind: "rule", text: `One support act for the whole run: ${support.name}${votes ? `, the agent's pick in ${votes} of ${picks.length} cities` : ", the artist that turned up in the most cities' lookups"}.`, result: "The other artists each city suggested are listed on its day sheet as local options" });
  }

  // The model's sentence was written for the room it chose; if a rule changed the room (or the sentence names an
  // opener who is no longer on the bill), it no longer describes the stop, so a plain rule sentence replaces it,
  // and then, with a call left, the agent rewrites those reasons for the stops as the rules settled them.
  const stale: Pick[] = [];
  for (const p of picks) {
    const score = allById.get(p.marketId)!;
    const room = p.rooms.find((x) => x.id === p.roomId);
    const oldOpener = p.openers.find((o) => o.id === p.modelOpenerId);
    const changed = (p.modelRoomId && p.roomId !== p.modelRoomId) || (oldOpener && oldOpener.id !== p.openerId && p.why?.includes(oldOpener.name));
    if ((changed || !p.why) && room) {
      p.why = `${score.name} is ${artist.name}'s #${score.rank} city on Qloo${room.capacity ? `, and ${room.name} holds ${n(room.capacity.value)}${p.nights === 2 ? " a night over two nights" : ""}` : `, and ${room.name} matches these fans at ${Math.round((room.affinity ?? 0) * 100)}`}.`;
      stale.push(p);
    }
  }
  if (check) {
    check.ruled = picks.filter((p) => !p.modelRoomId || p.roomId !== p.modelRoomId).length;
    check.suggested = picks.filter((p) => p.rooms.find((x) => x.id === p.roomId)?.origin === "agent").length;
    check.stops = picks.length;
  }
  if (planned === "model" && stale.length && extra < EXTRA_CALLS && left() >= minCall) {
    extra++;
    const t = Date.now();
    try {
      const facts = stale.map((p) => {
        const score = allById.get(p.marketId)!;
        const room = p.rooms.find((x) => x.id === p.roomId)!;
        return `- ${p.marketId}: ${score.name} is #${score.rank} of ${opts.cities.length} cities on Qloo's heatmap for ${artist.name} (fan affinity ${Math.round(score.affinity * 100)}). Room: ${room.name}${room.capacity ? `, holds ${room.capacity.value}${p.nights === 2 ? " a night, two nights booked" : ""}` : ", capacity not confirmed"}${room.affinity !== undefined ? `, matches these fans at ${Math.round(room.affinity * 100)}` : ""}.`;
      });
      const r = await ask<{ reasons: { city_id: string; why: string }[] }>({
        name: "reasons",
        schema: REASONS_SCHEMA,
        maxTokens: 2500,
        timeoutMs: 60_000,
        messages: [
          { role: "system", content: role(artist.name) },
          { role: "user", content: `The rules have settled the tour. These stops changed after you booked them (a room re-sized, a city filled or swapped by a rule). For each, write the "why": one natural sentence a manager would read on why this city and this room, citing one or two of the figures given and no other numbers.\n\n${facts.join("\n")}` },
        ],
      });
      model = r.model;
      let wrote = 0;
      for (const x of r.data.reasons ?? []) {
        const p = stale.find((q) => q.marketId === x.city_id);
        if (p && x.why?.trim()) {
          p.why = x.why.trim();
          wrote++;
        }
      }
      log({ kind: "model", text: `Wrote the reasons for the ${wrote} stop${wrote === 1 ? "" : "s"} the rules changed, after the rules settled.`, result: "Every figure in them is checked against the evidence", ms: Date.now() - t });
    } catch (e) {
      console.error("[plan] reasons failed", e);
      log({ kind: "model", text: "The agent didn't write the reasons for the stops the rules changed, so each keeps the rule's sentence.", failed: true, ms: Date.now() - t });
    }
  }
  for (const p of picks) {
    delete p.modelRoomId;
    delete p.modelOpenerId;
  }

  // The counterfactual (C2c): what the same rules would have booked on city size alone, from what this run already
  // fetched (no Qloo or model call), and where the two tours differ.
  let diff: QlooDiff | undefined;
  if (opts.region) {
    try {
      const population = await populationPlan({ cities: opts.cities, region: opts.region, shows, from: opts.from, usable: (id) => !rooms.has(id) || rooms.get(id)!.length > 0 });
      diff = qlooDiff(chosen.map((c) => ({ marketId: c.score.marketId, name: c.score.name })), population, opts.cities, opts.region);
      log({ kind: "rule", ...diffLine(diff, chosen.length) });
    } catch (e) {
      console.error("[plan] size-only plan failed", e);
    }
  }
  return { picks, planned, model, check, qlooDiff: diff, ...(settled.homeId ? { homeId: settled.homeId } : {}), ...(settled.tradeOff ? { tradeOff: settled.tradeOff } : {}) };
}

/** Without the model: the strongest affinity among rooms that fit the crowd, when capacities are known. */
export function bestRoom(rooms: Room[], draw?: number): Room | undefined {
  return chooseRoom(rooms, undefined, draw);
}
