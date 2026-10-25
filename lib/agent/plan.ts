import { km, marketById, marketLabel } from "../geo/markets";
import { ANCHOR_RANK, capCountries, HOME_RANK, homeCity, isAnchor, keepAnchors, keepHome, longLegs, MAX_LEG_KM, orderStops, radiusFor, repairLegs, roadKm, tooClose } from "../geo/route";
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
/** Cities tried in place of one with no bookable room (each costs its Qloo lookups and a few measurements). */
export const ROOM_SWAP_TRIES = 3;
/** A model call isn't started with less of the planning share left than this. */
const MIN_MODEL_MS = 8000;

const popOf = (id: string) => marketById(id)?.pop ?? 0;
const n = (v: number) => v.toLocaleString("en-US");

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
export function table(cities: CityScore[], from: { lat: number; lon: number }, RADIUS_KM: number, ranks?: Ranks): string {
  const signal = (c: CityScore) => (c.popularity !== undefined ? ` | signal ${Math.round(c.popularity * 100)}` : "");
  const rows = cities.map((c) =>
    ranks
      ? `${c.marketId} | ${c.label} | #${ranks.blend.get(c.marketId) ?? "–"} | #${c.rank} | #${ranks.pop.get(c.marketId) ?? "–"} | affinity ${Math.round(c.affinity * 100)}${signal(c)} | ${n(popOf(c.marketId))} people | ${Math.round(km(from, c))} km from start`
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
const compactRooms = (rooms: Room[], draw?: number) => rooms.map((r) => ({ id: r.id, name: r.name, affinity: p100(r.affinity), popularity: p100(r.popularity), kind: r.tags.slice(0, 3).join(", ") || null, capacity: r.capacity?.value ?? null, ...(draw ? { size: fit(r, draw) } : {}) }));
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
  rule: "candidate" | "duplicate" | "radius" | "rooms" | "room" | "leg" | "anchor" | "home" | "count" | "support";
  /** What the agent is told. */
  text: string;
  /** The same in a few words, for the call sheet. */
  short: string;
};

export type CheckContext = { byId: Map<string, CityScore>; rooms: Map<string, Room[]>; shows: number; draw?: number; from: { lat: number; lon: number }; radius: number };

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
    rows.push({ proposed: name(g.city_id), objection: objected(g.city_id) ?? (c && objected(c.city_id, ["anchor", "home"])) ?? "the agent's own change", chose: c ? name(c.city_id) : "dropped" });
  });
  for (const c of came.slice(gone.length)) rows.push({ proposed: "no stop", objection: objected(c.city_id, ["anchor", "home"]) ?? objections.find((o) => o.rule === "count")?.short ?? "the agent's own change", chose: name(c.city_id) });
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
  const keep = (c: { id: string; pop?: number }) => c.id === homeId || isAnchor({ rank: allById.get(c.id)?.rank ?? Infinity, pop: c.pop });
  let tradeOff: string | undefined;
  const apply = (swaps: { out: { id: string }; in: { id: string }; km: number; reason?: "leg" | "km-per-show" | "country" }[]) => {
    for (const sw of swaps) {
      const i = chosen.findIndex((c) => c.score.marketId === sw.out.id);
      if (i < 0) continue;
      chosen.splice(i, 1, o.make(allById.get(sw.in.id)!));
      o.on?.({ t: "swap", out: allById.get(sw.out.id)!, in: allById.get(sw.in.id)!, km: sw.km, reason: sw.reason });
    }
  };
  const legPass = async () => {
    const legs = await repairLegs({ from: o.from, stops: chosen.map((c) => asStop(c.score)), pool: pool.map(asStop), usable, weight: (c) => 1 / Math.sqrt(c.rank), radius, max, keep, first: first() });
    apply(legs.swaps);
    if (legs.tradeOff?.text) tradeOff = legs.tradeOff.text;
    if (o.region === "eu") apply((await capCountries({ from: o.from, stops: chosen.map((c) => asStop(c.score)), pool: pool.map(asStop), usable, radius, max, keep, first: first() })).swaps);
  };
  const rebuild = (stops: { id: string }[]) => {
    const was = new Map(chosen.map((c) => [c.score.marketId, c]));
    chosen.splice(0, chosen.length, ...stops.map((st) => was.get(st.id) ?? o.make(allById.get(st.id)!)));
  };
  await legPass();

  const anchored = await keepAnchors(chosen.map((c) => onFanMap(c.score)), deep.map(onFanMap), shows, usable, radius, max);
  for (const { anchor, out } of anchored.added) o.on?.({ t: "anchor", anchor: allById.get(anchor.id)!, out: out.map((x) => allById.get(x.id)!), close: out.some((x) => tooClose(x, anchor, radius)) });
  if (anchored.added.length) rebuild(anchored.stops);

  const homed = await keepHome({ from: o.from, stops: chosen.map((c) => onFanMap(c.score)), ranked: deep.map(onFanMap), shows, usable, radius, max });
  if (homed.added && homed.home) {
    o.on?.({ t: "home", home: allById.get(homed.home.id)!, out: homed.out.map((x) => allById.get(x.id)!) });
    rebuild(homed.stops);
  } else if (homed.home && homed.reason) o.on?.({ t: "no-home", home: allById.get(homed.home.id)!, reason: homed.reason });
  if (anchored.added.length || homed.added) await legPass();
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
  const blend = opts.region ? blendOrder(opts.cities, opts.region) : null;
  const cities = blend?.ordered ?? opts.cities;
  const topBlend = cities.slice(0, Math.max(shows * 2 + 4, 16));
  const candidates = [...topBlend, ...opts.cities.slice(0, QLOO_TOP_SHOWN).filter((c) => !topBlend.includes(c))];
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
  /** Before booking: the likeliest rooms of a city, in the order the room rule measures them, until one fits. */
  const premeasure = async (id: string) => {
    const c = allById.get(id) ?? byId.get(id);
    if (!draw || !c) return;
    for (const r of candidatesBySize(rooms.get(id) ?? [], draw).slice(0, PRE_MEASURE)) {
      await measure(r, c.label);
      if (fit(r, draw) === "fits") break;
    }
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
      const short = await ask<{ cities: { city_id: string; why: string }[]; alternates: string[] }>({
        name: "shortlist",
        schema: SHORTLIST_SCHEMA,
        maxTokens: 6000,
        timeoutMs: 90_000,
        messages: [
          { role: "system", content: role(artist.name) },
          {
            role: "user",
            content: shortlistPrompt({
              brief: brief(artist, opts.audience),
              from: opts.from,
              shows,
              draw,
              source: blend ? `Candidate cities for ${artist.name}, in blend order: Qloo's fan rank (where these fans over-index) averaged with size rank (metro population), the ranking that beat city size alone on real tours` : `Candidate cities from Qloo's heatmap for ${artist.name}, strongest first`,
              table: table(candidates, opts.from, RADIUS_KM, blend?.ranks),
              prefer: blend ? "weighing fan rank against city size (the blend order is a good guide; a city high on Qloo's fan rank is worth a stop even when it is small)" : "preferring stronger cities",
            }),
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
      await Promise.all([...shortlist, ...alternates].map(scout));
      if (draw) {
        const before = measured.size;
        await Promise.all(shortlist.map(premeasure));
        const fitting = shortlist.filter((id) => (rooms.get(id) ?? []).some((r) => fit(r, draw) === "fits")).length;
        log({ kind: "rule", text: `Measured the likeliest rooms in the ${shortlist.length} shortlisted cities before booking, so the agent books knowing what each holds.`, result: `${measured.size - before} rooms checked; a room confirmed to fit about ${n(draw)} in ${fitting} of ${shortlist.length} cities` });
      }

      // 3. Book.
      const t3 = Date.now();
      const evidence = [...shortlist, ...alternates].map((id) => ({
        city_id: id,
        city: byId.get(id)!.label,
        heatmap_rank: byId.get(id)!.rank,
        alternate: alternates.includes(id),
        rooms: compactRooms(rooms.get(id) ?? [], draw),
        openers: compactOpeners(openers.get(id) ?? []),
      }));
      bookMessages = [
        { role: "system", content: role(artist.name) },
        {
          role: "user",
          content: `${brief(artist, opts.audience)}\nShows wanted: ${shows}.${draw ? ` Usual crowd: about ${draw}. Each room shows its capacity where one was found and its size against this crowd ("fits", "too small", "too big", or "unknown" when no capacity was found): book a room that fits wherever a city has one. When a capacity is unknown, a room's popularity is a rough guide to its size, so prefer well-known rooms over tiny ones for a crowd this size.` : " Crowd size unknown: a room's popularity is a rough guide to its size."}\n\nScouting results (rooms and openers from Qloo for ${artist.name}'s fans):\n${JSON.stringify(evidence)}\n\nBook exactly ${shows} stops. For each: city_id, room_id from that city's rooms (a real music room: club, hall or theatre, not a festival, gallery or restaurant), opener_id: one support act for the whole run (it travels with the tour, as on a real tour), so use the same opener_id on every stop, choosing an artist that appears in several cities' openers and fits ${artist.name}'s genre, and "why": one natural sentence a manager would read, on why this city and this room, citing one or two figures (for example "Seattle is ${artist.name}'s #2 city on Qloo, and Barboza's crowd matches these fans at 84"). Don't list every field. Use an alternate city only when a shortlisted city has no room that fits. After you book, check_plan runs the tour's rules over it (the ${RADIUS_KM} km radius clause, the ${n(MAX_LEG_KM)} km leg cap, room fit, major markets) and sends back anything they object to.`,
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
    const ctx = (): CheckContext => ({ byId, rooms, shows, draw, from: opts.from, radius: RADIUS_KM });
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
    if (was.marketId !== settled.homeId) {
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
