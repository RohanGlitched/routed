import "server-only";
import { km, marketById } from "../geo/markets";
import { ANCHOR_RANK, keepAnchors, longLegs, MAX_LEG_KM, orderStops, radiusFor, repairLegs, tooClose } from "../geo/route";
import type { RegionId } from "../geo/markets";

import { MODELS, structured } from "../nebius";
import type { Artist, Audience, CityScore, Opener, Room } from "../types";
import { roomCapacity } from "../web";
import { AGE_LABEL, topAge } from "./audience";
import { fit } from "./evidence";
import { candidatesBySize, chooseRoom, pickSupport, REDUCED_MAX, reducedHouse, twoNights } from "./rooms";
import { lookUpOpeners, lookUpRooms, type Log } from "./tools";

/**
 * The agent, in three moves a booking agent would make:
 *  1. Shortlist (model): from Qloo's ranked heatmap, choose the cities worth a look plus a few alternates,
 *     weighing fan strength against geography.
 *  2. Scout (tools): for every shortlisted city, ask Qloo for the rooms these fans go to and the openers who
 *     share the audience, and check the favoured rooms' capacity on the web when the crowd size is known.
 *  3. Book (model): pick the final cities, one room each and one support act for the run, swapping in an alternate wherever a
 *     city's rooms don't fit, with a one-sentence reason that cites the evidence.
 * A free-running tool loop was tried first: Nemotron repeated lookups and ran out of turns on most tours
 * (measured Oct 7), so the moves are fixed and the choices are the model's. Rules hold it in (Playbook L1/L2):
 * cities must come from the candidates, the radius clause is enforced, a major market in the top ten stays, no
 * leg between shows runs over MAX_LEG_KM where a city could close it, rooms are sized to the crowd, and one
 * support act plays the whole run. Without the model (no key, budget spent, or it fails) the same steps run as a
 * fixed plan.
 */

export type Pick = { marketId: string; rooms: Room[]; roomId?: string; openers: Opener[]; openerId?: string; why?: string; nights?: number; modelRoomId?: string; modelOpenerId?: string };

type BookStop = { city_id: string; room_id: string; opener_id: string; why: string };

export type PlanResult = { picks: Pick[]; planned: "model" | "fixed"; model?: string };

export { MAX_LEG_KM };
export { ANCHOR_RANK };
/** How deep in the ranking the leg rule may look for a city that closes a long leg. */
export const POOL_SIZE = 60;
/** Rooms measured per city, after the agent's choice, until one fits the crowd. */
export const MEASURE_PER_CITY = 8;

const popOf = (id: string) => marketById(id)?.pop ?? 0;

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

export const role = (artist: string) =>
  `You are a booking agent routing a tour for ${artist}. Your evidence is Qloo's taste graph for ${artist}'s fans: a heatmap ranking of cities, and per-city lists of the rooms those fans go to and the artists (possible openers) who share the audience. Openers are other artists, never ${artist}. Use only numbers from the evidence.`;

export function table(cities: CityScore[], from: { lat: number; lon: number }, RADIUS_KM: number): string {
  const rows = cities.map((c) => `${c.marketId} | ${c.label} | #${c.rank} | affinity ${Math.round(c.affinity * 100)}${c.popularity !== undefined ? ` | signal ${Math.round(c.popularity * 100)}` : ""} | ${Math.round(km(from, c))} km from start`);
  const close: string[] = [];
  const at = (c: CityScore) => ({ lat: c.lat, lon: c.lon, pop: popOf(c.marketId) });
  for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) if (tooClose(at(cities[i]!), at(cities[j]!), RADIUS_KM)) close.push(`${cities[i]!.marketId} ~ ${cities[j]!.marketId}`);
  return `city_id | city | strength rank | fan affinity (0-100) | taste signal (0-100) | distance\n${rows.join("\n")}${close.length ? `\n\nToo close to pair (radius clause, ${RADIUS_KM} km): ${close.join("; ")}` : ""}`;
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

export async function planTour(opts: { artist: Artist; audience: Audience; cities: CityScore[]; from: { lat: number; lon: number; label: string }; region?: RegionId; shows: number; draw?: number; useModel: boolean; log: Log }): Promise<PlanResult> {
  const { artist, cities, shows, log, draw } = opts;
  const RADIUS_KM = radiusFor(opts.region);
  const candidates = cities.slice(0, Math.max(shows * 2 + 4, 16));
  const byId = new Map(candidates.map((c) => [c.marketId, c]));
  const allById = new Map(cities.map((c) => [c.marketId, c]));
  const rooms = new Map<string, Room[]>();
  const openers = new Map<string, Opener[]>();
  const getRooms = async (id: string) => {
    if (!rooms.has(id)) rooms.set(id, await lookUpRooms(artist, id, log, draw));
    return rooms.get(id)!;
  };
  const getOpeners = async (id: string) => {
    if (!openers.has(id)) openers.set(id, await lookUpOpeners(artist, id, log));
    return openers.get(id)!;
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
    const cap = await roomCapacity(room, city).catch(() => null);
    if (cap) room.capacity = cap;
    log({ kind: "web", text: `How many does ${room.name} hold?`, result: cap ? `${cap.value.toLocaleString("en-US")}, per ${host(cap.source)}` : "Not found; ask the room." });
  };

  let booked: BookStop[] | null = null;
  let model: string | undefined;

  if (opts.useModel) {
    try {
      // 1. Shortlist.
      const t1 = Date.now();
      const short = await structured<{ cities: { city_id: string; why: string }[]; alternates: string[] }>(MODELS.agent, {
        name: "shortlist",
        schema: SHORTLIST_SCHEMA,
        maxTokens: 6000,
        timeoutMs: 90_000,
        messages: [
          { role: "system", content: role(artist.name) },
          {
            role: "user",
            content: shortlistPrompt({ brief: brief(artist, opts.audience), from: opts.from, shows, draw, source: `Candidate cities from Qloo's heatmap for ${artist.name}, strongest first`, table: table(candidates, opts.from, RADIUS_KM), prefer: "preferring stronger cities" }),
          },
        ],
      });
      model = short.model;
      const shortlist = [...new Set(short.data.cities.map((c) => c.city_id).filter((id) => byId.has(id)))];
      const alternates = [...new Set(short.data.alternates.filter((id) => byId.has(id) && !shortlist.includes(id)))].slice(0, 3);
      if (process.env.ROUTED_DEBUG) console.log("[plan] shortlist", shortlist, alternates);
      log({ kind: "model", text: `Shortlisted ${shortlist.length} cities and ${alternates.length} alternates from Qloo's ranking.`, result: [...shortlist.map((id) => byId.get(id)!.name), ...(alternates.length ? [`alternates: ${alternates.map((id) => byId.get(id)!.name).join(", ")}`] : [])].join(", "), ms: Date.now() - t1 });
      if (!shortlist.length) throw new Error("empty shortlist");

      // 2. Scout every shortlisted city and alternate.
      await Promise.all([...shortlist, ...alternates].map(scout));

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
      const book = await structured<{ stops: BookStop[] }>(MODELS.agent, {
        name: "book",
        schema: BOOK_SCHEMA,
        maxTokens: 8000,
        timeoutMs: 120_000,
        messages: [
          { role: "system", content: role(artist.name) },
          {
            role: "user",
            content: `${brief(artist, opts.audience)}\nShows wanted: ${shows}.${draw ? ` Usual crowd: about ${draw}. Capacities are checked on the web after you book; a room's popularity is a rough guide to its size, so prefer well-known rooms over tiny ones for a crowd this size.` : " Crowd size unknown: a room's popularity is a rough guide to its size."}\n\nScouting results (rooms and openers from Qloo for ${artist.name}'s fans):\n${JSON.stringify(evidence)}\n\nBook exactly ${shows} stops. For each: city_id, room_id from that city's rooms (a real music room: club, hall or theatre, not a festival, gallery or restaurant), opener_id: one support act for the whole run (it travels with the tour, as on a real tour), so use the same opener_id on every stop, choosing an artist that appears in several cities' openers and fits ${artist.name}'s genre, and "why": one natural sentence a manager would read, on why this city and this room, citing one or two figures (for example "Seattle is ${artist.name}'s #2 city on Qloo, and Barboza's crowd matches these fans at 84"). Don't list every field. Use an alternate city only when a shortlisted city has no room that fits.`,
          },
        ],
      });
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

  // Guard the model's answer: real candidates only, no duplicates, radius clause, rooms to book, the right count.
  type Chosen = { score: CityScore; why?: string; roomId?: string; openerId?: string };
  const placed = (c: CityScore) => ({ lat: c.lat, lon: c.lon, pop: popOf(c.marketId) });
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

  // Fill from the ranking (the whole plan when there's no model), skipping cities with no rooms at all. In a
  // small region the radius clause can use up the first candidates, so the fill looks down to POOL_SIZE.
  const before = chosen.length;
  const deep = cities.slice(0, Math.max(candidates.length, POOL_SIZE));
  for (const score of deep) {
    if (chosen.length >= shows) break;
    if (chosen.some((x) => x.score.marketId === score.marketId || clash(x.score, score))) continue;
    if (!(await getRooms(score.marketId)).length) continue;
    chosen.push({ score });
  }
  if (planned === "fixed") log({ kind: "rule", text: `Fixed plan: the ${chosen.length} strongest cities that clear the ${RADIUS_KM} km radius clause and have rooms.`, result: chosen.map((c) => c.score.name).join(", ") });
  else if (chosen.length > before) log({ kind: "rule", text: `The agent booked ${before} usable stops; the ranking filled the other ${chosen.length - before}.`, result: chosen.slice(before).map((c) => c.score.name).join(", ") });

  const asStop = (c: CityScore) => ({ ...c, id: c.marketId, pop: popOf(c.marketId) });
  const usable = async (c: { id: string }) => (await getRooms(c.id)).length > 0;
  const pool = cities.slice(0, POOL_SIZE);

  // The leg rule: no leg between two shows longer than MAX_LEG_KM of road. Groups of stops that can't reach each
  // other are pulled into the strongest group (by fan strength, so a tour keeps the artist's best cities, plus a
  // little for the group the starting city can reach), then any long leg left is broken by a swap.
  const legPass = async () => {
    const legs = await repairLegs({ from: opts.from, stops: chosen.map((c) => asStop(c.score)), pool: pool.map(asStop), usable, weight: (c) => 1 / Math.sqrt(c.rank), radius: RADIUS_KM });
    for (const sw of legs.swaps) {
      const i = chosen.findIndex((c) => c.score.marketId === sw.out.id);
      if (i < 0) continue;
      chosen.splice(i, 1, { score: allById.get(sw.in.id)! });
      log({ kind: "rule", text: `${sw.out.name} would cost a ${sw.km.toLocaleString("en-US")} km leg with no show, so ${sw.in.name} (#${sw.in.rank} on the fan map) takes its place.`, result: `No leg between shows over ${MAX_LEG_KM.toLocaleString("en-US")} km where a city with rooms can close it` });
    }
  };
  await legPass();

  // The anchor rule: a major market (1.5 million or more) in the artist's top ten is always on the tour when the
  // route can reach it. No UK tour skips London because Brighton was booked first: the smaller city inside the
  // radius gives way, and when the tour is full the weakest stop that isn't an anchor does.
  const anchored = await keepAnchors(chosen.map((c) => asStop(c.score)), deep.map(asStop), shows, usable, RADIUS_KM);
  for (const { anchor, out } of anchored.added) {
    log({ kind: "rule", text: `${anchor.name} is a major market and #${anchor.rank} on ${artist.name}'s fan map, so it stays on the tour${out.length ? ` and ${out.map((o) => o.name).join(" and ")} give${out.length === 1 ? "s" : ""} way` : ""}.`, result: out.some((o) => tooClose(o, anchor, RADIUS_KM)) ? `${out.map((o) => o.name).join(" and ")} ${out.length === 1 ? "is" : "are"} inside the ${RADIUS_KM} km radius of ${anchor.name}` : `${anchor.name} added` });
  }
  if (anchored.added.length) {
    const keep = new Map(chosen.map((c) => [c.score.marketId, c]));
    chosen.splice(0, chosen.length, ...anchored.stops.map((st) => keep.get(st.id) ?? { score: allById.get(st.id)! }));
    await legPass();
  }
  const leftover = longLegs(opts.from, orderStops(opts.from, chosen.map((c) => c.score)));
  if (leftover.length) log({ kind: "rule", text: `${leftover.length === 1 ? "One leg is" : `${leftover.length} legs are`} still over ${MAX_LEG_KM.toLocaleString("en-US")} km: no city with rooms within reach could close ${leftover.length === 1 ? "it" : "them"}, so the day sheet flags ${leftover.length === 1 ? "it" : "them"}.`, failed: true });

  // Every picked city gets its lookups, whatever the model skipped. With a known crowd the booked room's capacity
  // is checked, then the city's other rooms in order (best-known first for a big crowd, best-matched for a small
  // one) until one fits, up to eight checks a city. The room is then chosen by rule: a known fit for one night,
  // else a known two-night stand, else a room whose capacity couldn't be found, and a known misfit only when
  // nothing else is left (and the sheet says so).
  const picks = await Promise.all(
    chosen.map(async (c): Promise<Pick> => {
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
      const room = chooseRoom(r, c.roomId ?? first?.id, draw);
      const nights = room && twoNights(room, draw) && !r.some((x) => fit(x, draw) === "fits") ? 2 : 1;
      if (room && c.roomId && room.id !== c.roomId) {
        const was = r.find((x) => x.id === c.roomId);
        log({ kind: "rule", text: `${was?.name ?? "The agent's room"} ${was?.capacity ? `holds ${was.capacity.value.toLocaleString("en-US")}, ${fit(was, draw)} for a crowd of about ${draw!.toLocaleString("en-US")}` : "couldn't be confirmed for the crowd"}, so ${c.score.name} gets ${room.name}.`, result: room.capacity ? `${room.name} holds ${room.capacity.value.toLocaleString("en-US")}${nights === 2 ? ": two nights" : fit(room, draw) === "fits" ? "" : " (the nearest size that could be confirmed)"}` : `${room.name}: capacity not found, ask the room` });
      } else if (room && reducedHouse(room, draw) && !r.some((x) => fit(x, draw) === "fits")) {
        log({ kind: "rule", text: `${room.name} holds ${room.capacity!.value.toLocaleString("en-US")}, more than the usual crowd of about ${draw!.toLocaleString("en-US")}, and no room in ${c.score.name} was confirmed to fit, so the pitch asks for a reduced configuration.`, result: `Up to ${REDUCED_MAX} times the crowd can be booked that way` });
      } else if (nights === 2 && room) {
        log({ kind: "rule", text: `${room.name} holds ${room.capacity!.value.toLocaleString("en-US")}, under the usual crowd of about ${draw!.toLocaleString("en-US")}, and no room in ${c.score.name} was confirmed to fit, so it's two nights.`, result: `${(room.capacity!.value * 2).toLocaleString("en-US")} across both nights` });
      }
      return { marketId: c.score.marketId, rooms: r, roomId: room?.id, openers: o, openerId: o.some((x) => x.id === c.openerId) ? c.openerId : undefined, why: c.why, nights, modelRoomId: c.roomId, modelOpenerId: c.openerId };
    }),
  );

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
  // opener who is no longer on the bill), it no longer describes the stop, so a plain rule sentence replaces it.
  for (const p of picks) {
    const score = allById.get(p.marketId)!;
    const room = p.rooms.find((x) => x.id === p.roomId);
    const oldOpener = p.openers.find((o) => o.id === p.modelOpenerId);
    const stale = (p.modelRoomId && p.roomId !== p.modelRoomId) || (oldOpener && oldOpener.id !== p.openerId && p.why?.includes(oldOpener.name));
    if ((stale || !p.why) && room) p.why = `${score.name} is ${artist.name}'s #${score.rank} city on Qloo${room.capacity ? `, and ${room.name} holds ${room.capacity.value.toLocaleString("en-US")}${p.nights === 2 ? " a night over two nights" : ""}` : `, and ${room.name} matches these fans at ${Math.round((room.affinity ?? 0) * 100)}`}.`;
    delete p.modelRoomId;
    delete p.modelOpenerId;
  }
  return { picks, planned, model };
}

/** Without the model: the strongest affinity among rooms that fit the crowd, when capacities are known. */
export function bestRoom(rooms: Room[], draw?: number): Room | undefined {
  return chooseRoom(rooms, undefined, draw);
}
