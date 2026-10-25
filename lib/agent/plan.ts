import { km, marketById, marketLabel } from "../geo/markets";
import { ANCHOR_RANK, capCountries, describeTradeOff, HOME_RANK, homeCity, isAnchor, keepAnchors, keepHome, longLegs, MAX_LEG_KM, orderStops, radiusFor, repairLegs, roadKm, tooClose } from "../geo/route";
import type { RegionId } from "../geo/markets";
import { populationRanking } from "../headtohead";
import type { Msg } from "../nebius";
import type { AgentCheck, Artist, Audience, Capacity, CityScore, LogLine, Opener, QlooDiff, Room } from "../types";
import { AGE_LABEL, topAge } from "./audience";
import { fit } from "./evidence";
import { blendOrder, diffLine, qlooDiff, sizeRanks, type Ranks } from "./qloodiff";
import { candidatesBySize, chooseRoom, pickSupport, REDUCED_MAX, reducedHouse, roomCheck, twoNights } from "./rooms";
import type { Log } from "./tools";

/**
 * The agent, in the moves a booking agent would make:
 *  1. Shortlist (model): from Qloo's heatmap in blend order (fan rank weighed against city size, the ranking that
 *     beat size alone on real tours), choose the cities worth a look plus a few alternates.
 *  2. Scout (tools): for every shortlisted city, ask Qloo for the rooms these fans go to and the openers who
 *     share the audience; with a known crowd, measure the likeliest rooms before booking.
 *  3. Book (model): pick the final cities, one room each and one support act for the run, knowing what each room
 *     holds, with a one-sentence reason that cites the evidence.
 *  4. Check (rules as a tool): check_plan runs the tour's rules over the booking and sends every objection back to
 *     the agent, which re-books; at most two rounds. Only what is still broken after that is fixed by a rule.
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
  findPlace?: (artist: Artist, name: string, marketId: string, draw?: number) => Promise<Room | null>;
  /** The artist's fans' affinity for these places, in one call. */
  scoreRooms?: (artist: Artist, ids: string[]) => Promise<Map<string, number>>;
  roomCapacity: (room: Room, city: string) => Promise<Capacity | null>;
};

export { MAX_LEG_KM };
export { ANCHOR_RANK };
/** How deep in the ranking the leg rule may look for a city that closes a long leg. */
export const POOL_SIZE = 60;
/** Rooms measured per city, after the agent's choice, until one fits the crowd. */
export const MEASURE_PER_CITY = 8;
/** Rooms measured per shortlisted city before the book call, in the order the room rule would measure them. */
export const PRE_MEASURE = 4;
/** check_plan's objections go back to the agent at most this many times. */
export const MAX_REVISIONS = 2;
/** Model calls the agent may add to shortlist + book: revision rounds and the final reasons together. */
export const EXTRA_CALLS = 2;
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

/**
 * Two room names are the same room: folded, without "the", punctuation and words like "theatre" or "hall"
 * that sites add or drop ("Ryman" and "Ryman Auditorium"; "The Basement East" and "Basement East", but never
 * "The Basement" and "The Basement East").
 */
export function sameRoomName(a: string, b: string): boolean {
  const words = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !["the", "a", "at", "of", "and", "theatre", "theater", "hall", "auditorium", "music", "venue", "club", "live", "center", "centre", "arena", "ballroom", "amphitheatre", "amphitheater"].includes(w));
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  // Equal, or a longer name that adds a word to a two-word one; "Basement" and "Basement East" are two rooms.
  return (short.length === long.length || short.length >= 2) && short.every((w) => long.includes(w));
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
};

export type CheckContext = { byId: Map<string, CityScore>; rooms: Map<string, Room[]>; shows: number; draw?: number; from: { lat: number; lon: number }; radius: number; /** Qloo's top fan cities, kept like anchors. */ mustKeep?: Set<string> };

const placed = (c: CityScore) => ({ lat: c.lat, lon: c.lon, pop: popOf(c.marketId) });
const sizeWord = (r: Room, draw?: number) => (r.capacity ? `holds ${n(r.capacity.value)}${draw ? ` (${fit(r, draw)} for about ${n(draw)})` : ""}` : "has no confirmed capacity");

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
    if (best && best.id !== room.id) out.push({ city_id: s.city_id, rule: "room", text: `${room.name} ${sizeWord(room, c.draw)}; the room rule would book ${best.name} (${best.id}), which ${sizeWord(best, c.draw)}. Book a room that fits the crowd.`, short: `${room.name} ${room.capacity ? `holds ${n(room.capacity.value)}, ${fit(room, c.draw)}` : "has no confirmed capacity"}` });
  }

  const ordered = orderStops(c.from, kept.map((k) => k.score));
  for (const l of longLegs(c.from, ordered)) {
    const a = ordered[l.index - 1]!, b = ordered[l.index]!;
    out.push({ city_id: b.marketId, rule: "leg", text: `${a.name} to ${b.name} is ${n(l.km)} km of road with no show between, over the ${n(MAX_LEG_KM)} km leg cap: keep the tour in one part of the region.`, short: `${n(l.km)} km leg from ${a.name}` });
  }

  // A major market in the top ten the route can reach stays on the tour (keepAnchors).
  for (const a of c.byId.values()) {
    if (!isAnchor({ rank: a.rank, pop: popOf(a.marketId) }) || kept.some((k) => k.score.marketId === a.marketId)) continue;
    if (kept.some((k) => isAnchor({ rank: k.score.rank, pop: popOf(k.score.marketId) }) && tooClose(placed(k.score), placed(a), c.radius))) continue;
    if (kept.length && !kept.some((k) => roadKm(k.score, a) <= MAX_LEG_KM)) continue;
    out.push({ city_id: a.marketId, rule: "anchor", text: `${a.name} (${a.marketId}) is a major market and #${a.rank} on the fan map: the anchor rule keeps it on the tour, so book it in place of your weakest stop.`, short: `${a.name} is a major market, #${a.rank} (anchor rule)` });
  }

  // Qloo's top fan cities stay, whatever their size, when another candidate is within the leg cap of them.
  for (const id of c.mustKeep ?? []) {
    const f = c.byId.get(id);
    if (!f || kept.some((k) => k.score.marketId === id)) continue;
    if (![...c.byId.values()].some((x) => x.marketId !== id && roadKm(x, f) <= MAX_LEG_KM)) continue;
    const near = kept.find((k) => tooClose(placed(k.score), placed(f), c.radius));
    if (near && c.mustKeep!.has(near.score.marketId)) continue;
    out.push({ city_id: id, rule: "fan", text: `${f.name} (${id}) is #${f.rank} on Qloo's fan map, one of the artist's ${FAN_KEEP} strongest fan cities: keep it on the tour${near ? `, in place of ${near.score.name} inside its radius` : ", in place of your weakest stop"}.`, short: `${f.name} is fan city #${f.rank} (kept like an anchor)` });
  }

  // The starting city, when it is in the artist's top HOME_RANK, opens the run (keepHome).
  const home = homeCity(c.from, [...c.byId.values()].map((x) => ({ ...x, id: x.marketId, pop: popOf(x.marketId) })));
  if (home && !kept.some((k) => k.score.marketId === home.id)) out.push({ city_id: home.id, rule: "home", text: `${home.name} (${home.id}) is where the tour starts and #${home.rank} on the fan map (top ${HOME_RANK}): the hometown rule opens the run there, so book it in place of your weakest stop.`, short: `${home.name} is the hometown, #${home.rank}` });

  const replaced = out.filter((o) => ["candidate", "duplicate", "radius", "rooms"].includes(o.rule)).length;
  if (kept.length + replaced < c.shows) out.push({ rule: "count", text: `Only ${kept.length} of the ${c.shows} stops can be booked: book ${c.shows}.`, short: `${kept.length} of ${c.shows} stops usable` });
  if (new Set(kept.map((k) => k.s.opener_id)).size > 1) out.push({ rule: "support", text: "One support act travels with the whole run: use the same opener_id on every stop.", short: "one support act for the run" });
  return out;
}

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

function revisePrompt(objections: Objection[], shows: number, others: CityScore[]): string {
  return `check_plan ran the tour's rules over your booking and objects to ${objections.length === 1 ? "one thing" : `${objections.length} things`}:\n${objections.map((o) => `- ${o.text}`).join("\n")}\n\n${others.length ? `Other candidate cities (not scouted yet; their rooms are looked up if you book one): ${others.map((c) => `${c.marketId} (${c.name}, fan #${c.rank})`).join(", ")}.\n\n` : ""}Re-book exactly ${shows} stops in the same JSON shape. Keep every stop the check didn't object to; change only what an objection names, using city_ids from the candidates and room_ids from that city's rooms. Write each "why" for the stop as you now book it.`;
}

/* ───────────────────────── the city rules ───────────────────────── */

export type SettleEvent =
  | { t: "fill"; cities: CityScore[] }
  | { t: "swap"; out: CityScore; in: CityScore; km: number; reason?: "leg" | "km-per-show" | "country" }
  | { t: "anchor"; anchor: CityScore; out: CityScore[]; close: boolean }
  | { t: "home"; home: CityScore; out: CityScore[] }
  | { t: "fan"; city: CityScore; out: CityScore[]; bridge?: CityScore }
  | { t: "no-fan"; city: CityScore }
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

  const homed = await keepHome({ from: o.from, stops: chosen.map((c) => onFanMap(c.score)), ranked: deep.map(onFanMap), shows, usable, radius, max });
  if (homed.added && homed.home) {
    o.on?.({ t: "home", home: allById.get(homed.home.id)!, out: homed.out.map((x) => allById.get(x.id)!) });
    rebuild(homed.stops);
  } else if (homed.home && homed.reason) o.on?.({ t: "no-home", home: allById.get(homed.home.id)!, reason: homed.reason });
  if (anchored.added.length || fans || homed.added) await legPass();
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
  opts: { artist: Artist; audience: Audience; cities: CityScore[]; from: { lat: number; lon: number; label: string }; region?: RegionId; shows: number; draw?: number; useModel: boolean; log: Log; /** Epoch ms by which the agent's model calls must be done (run.ts gives planning a share of the run). */ deadline?: number; /** Least time worth starting a model call with (tests shorten it). */ minCallMs?: number },
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
  const measure = async (room: Room, city: string) => {
    if (room.capacity !== undefined || measured.has(room.id)) return;
    measured.add(room.id);
    const cap = await deps.roomCapacity(room, city).catch(() => null);
    if (cap) room.capacity = cap;
    log({ kind: "web", text: `How many does ${room.name} hold?`, result: cap ? `${n(cap.value)}, per ${host(cap.source)}` : "Not found; ask the room." });
  };
  /** Before booking: the rooms the agent named, then the likeliest of the rest in the order the room rule measures
   *  them, until one fits. */
  const premeasure = async (id: string) => {
    const c = allById.get(id) ?? byId.get(id);
    if (!draw || !c) return;
    const all = rooms.get(id) ?? [];
    const order = [...all.filter((r) => r.origin === "agent"), ...candidatesBySize(all.filter((r) => r.origin !== "agent"), draw).slice(0, PRE_MEASURE)];
    for (const r of order) {
      await measure(r, c.label);
      if (fit(r, draw) === "fits") break;
    }
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
        for (const name of names) {
          if (list.some((r) => sameRoomName(r.name, name))) {
            already.push(`${name} (${city})`);
            continue;
          }
          if (searches >= NAMED_SEARCHES) break;
          searches++;
          const r = await deps.findPlace!(artist, name, id, draw).catch(() => null);
          if (!r || !sameRoomName(r.name, name)) {
            missed.push(`${name} in ${city}`);
            log({ kind: "qloo", text: `The agent suggested ${name} in ${city}; Qloo has no such room here.`, failed: true });
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
    let messages = bookMessages;
    let rounds = 0;
    while (objections.length && rounds < MAX_REVISIONS && extra < EXTRA_CALLS) {
      if (left() < minCall) {
        log({ kind: "rule", text: "No time left for the agent to answer the check, so the rules settle what's left.", failed: true });
        break;
      }
      rounds++;
      extra++;
      const t = Date.now();
      const others = candidates.filter((c) => !rooms.has(c.marketId)).slice(0, 12);
      messages = [...messages, { role: "assistant", content: JSON.stringify({ stops: booked }) }, { role: "user", content: revisePrompt(objections, shows, others) }];
      let next: BookStop[];
      try {
        const r = await ask<{ stops: BookStop[] }>({ name: "rebook", schema: BOOK_SCHEMA, maxTokens: 8000, timeoutMs: 90_000, messages });
        model = r.model;
        next = r.data.stops ?? [];
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
      const swaps = bookingSwaps(booked, next, objections, name, roomName);
      const after = checkPlan(next, ctx());
      log({ kind: "model", text: `The agent re-booked after the check (round ${rounds} of ${MAX_REVISIONS}).`, result: `${swaps.length ? `${swaps.length} pick${swaps.length === 1 ? "" : "s"} changed` : "No pick changed"}; ${after.length ? `${after.length} objection${after.length === 1 ? "" : "s"} left: ${after.map((o) => `${o.city_id ? `${name(o.city_id)}: ` : ""}${o.short}`).join("; ")}` : "every rule clears"}`, swaps, ms: Date.now() - t });
      booked = next;
      objections = after;
    }
    if (objections.length && rounds) log({ kind: "rule", text: `${objections.length === 1 ? "One objection still stands" : `${objections.length} objections still stand`} after the agent's ${rounds === 1 ? "revision" : `${rounds} revisions`}, so the rules settle ${objections.length === 1 ? "it" : "them"}.` });
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
  const leftover = longLegs(opts.from, orderStops(opts.from, chosen.map((c) => ({ ...c.score, id: c.score.marketId })), { max: MAX_LEG_KM, first: settled.homeId }), MAX_LEG_KM);
  if (leftover.length) log({ kind: "rule", text: `${leftover.length === 1 ? "One leg is" : `${leftover.length} legs are`} still over ${n(MAX_LEG_KM)} km: no city with rooms within reach could close ${leftover.length === 1 ? "it" : "them"}, so the day sheet flags ${leftover.length === 1 ? "it" : "them"}.`, failed: true });

  // Every picked city gets its lookups, whatever the model skipped. With a known crowd the booked room's capacity
  // is checked, then the city's other rooms in order (best-known first for a big crowd, best-matched for a small
  // one) until one fits, up to eight checks a city. The room is then chosen by rule: a known fit for one night,
  // else a known two-night stand, else a room whose capacity couldn't be found, and a known misfit only when
  // nothing else is left (and the sheet says so).
  // A city whose rooms can't take this crowd (rooms.ts roomCheck: only misfits, or nothing measurable for 3,000 or
  // more) gives way to the next ranked city that clears the radius, adds no long leg and has a bookable room.
  const pickFor = async (c: Chosen): Promise<{ pick: Pick; bookable: boolean; reason?: string }> => {
      const [r, o] = await Promise.all([getRooms(c.score.marketId), getOpeners(c.score.marketId)]);
      const city = c.score.label;
      const first = r.find((x) => x.id === c.roomId) ?? r[0];
      if (first) await measure(first, city);
      if (draw && first && fit(first, draw) !== "fits") {
        for (const next of candidatesBySize(r.filter((x) => x !== first), draw).slice(0, MEASURE_PER_CITY)) {
          await measure(next, city);
          if (fit(next, draw) === "fits") break;
        }
      }
      const check = roomCheck(r, c.roomId ?? first?.id, draw);
      const room = check.room;
      const nights = room && twoNights(room, draw) && !r.some((x) => fit(x, draw) === "fits") ? 2 : 1;
      if (room && c.roomId && room.id !== c.roomId) {
        const was = r.find((x) => x.id === c.roomId);
        log({ kind: "rule", text: `${was?.name ?? "The agent's room"} ${was?.capacity ? `holds ${n(was.capacity.value)}, ${fit(was, draw)} for a crowd of about ${n(draw!)}` : "couldn't be confirmed for the crowd"}, so ${c.score.name} gets ${room.name}.`, result: room.capacity ? `${room.name} holds ${n(room.capacity.value)}${nights === 2 ? ": two nights" : fit(room, draw) === "fits" ? "" : " (the nearest size that could be confirmed)"}` : `${room.name}: capacity not found, ask the room` });
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
  const support = pickSupport(picks);
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
