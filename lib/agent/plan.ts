import "server-only";
import { km } from "../geo/markets";
import { pickCities, RADIUS_KM } from "../geo/route";
import { MODELS, structured } from "../nebius";
import type { Artist, Audience, CityScore, Opener, Room } from "../types";
import { roomCapacity } from "../web";
import { AGE_LABEL, topAge } from "./audience";
import { fit } from "./evidence";
import { lookUpOpeners, lookUpRooms, type Log } from "./tools";

/**
 * The agent, in three moves a booking agent would make:
 *  1. Shortlist (model): from Qloo's ranked heatmap, choose the cities worth a look plus a few alternates,
 *     weighing fan strength against geography.
 *  2. Scout (tools): for every shortlisted city, ask Qloo for the rooms these fans go to and the openers who
 *     share the audience, and check the favoured rooms' capacity on the web when the crowd size is known.
 *  3. Book (model): pick the final cities, one room and one opener each, swapping in an alternate wherever a
 *     city's rooms don't fit, with a one-sentence reason that cites the evidence.
 * A free-running tool loop was tried first: Nemotron repeated lookups and ran out of turns on most tours
 * (measured Oct 7), so the moves are fixed and the choices are the model's. Rules hold it in (Playbook L1/L2):
 * cities must come from the candidates, the radius clause is enforced, and gaps are filled from the ranking.
 * Without the model (no key, budget spent, or it fails) the same steps run as a fixed plan.
 */

export type Pick = { marketId: string; rooms: Room[]; roomId?: string; openers: Opener[]; openerId?: string; why?: string };

type BookStop = { city_id: string; room_id: string; opener_id: string; why: string };

export type PlanResult = { picks: Pick[]; planned: "model" | "fixed"; model?: string };

const SHORTLIST_SCHEMA = {
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

const role = (artist: string) =>
  `You are a booking agent routing a tour for ${artist}. Your evidence is Qloo's taste graph for ${artist}'s fans: a heatmap ranking of cities, and per-city lists of the rooms those fans go to and the artists (possible openers) who share the audience. Openers are other artists, never ${artist}. Use only numbers from the evidence.`;

function table(cities: CityScore[], from: { lat: number; lon: number }): string {
  const rows = cities.map((c) => `${c.marketId} | ${c.label} | #${c.rank} | affinity ${Math.round(c.affinity * 100)}${c.popularity !== undefined ? ` | signal ${Math.round(c.popularity * 100)}` : ""} | ${Math.round(km(from, c))} km from start`);
  const close: string[] = [];
  for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) if (km(cities[i]!, cities[j]!) < RADIUS_KM) close.push(`${cities[i]!.marketId} ~ ${cities[j]!.marketId}`);
  return `city_id | city | strength rank | fan affinity (0-100) | taste signal (0-100) | distance\n${rows.join("\n")}${close.length ? `\n\nToo close to pair (radius clause, ${RADIUS_KM} km): ${close.join("; ")}` : ""}`;
}

function brief(artist: Artist, audience: Audience): string {
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
const compactOpeners = (o: Opener[]) => o.map((x) => ({ id: x.id, name: x.name, affinity: p100(x.affinity) }));

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export async function planTour(opts: { artist: Artist; audience: Audience; cities: CityScore[]; from: { lat: number; lon: number; label: string }; shows: number; draw?: number; useModel: boolean; log: Log }): Promise<PlanResult> {
  const { artist, cities, shows, log, draw } = opts;
  const candidates = cities.slice(0, Math.max(shows * 2 + 4, 16));
  const byId = new Map(candidates.map((c) => [c.marketId, c]));
  const rooms = new Map<string, Room[]>();
  const openers = new Map<string, Opener[]>();
  const getRooms = async (id: string) => {
    if (!rooms.has(id)) rooms.set(id, await lookUpRooms(artist, id, log));
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
  /** A room's capacity from the web (each search costs a credit, so only for rooms about to be booked). */
  const measure = async (room: Room, city: string) => {
    if (room.capacity !== undefined) return;
    const cap = await roomCapacity(room.name, city).catch(() => null);
    if (cap) room.capacity = cap;
    log({ kind: "web", text: `How many does ${room.name} hold?`, result: cap ? `${cap.value.toLocaleString("en-US")}, per ${host(cap.source)}` : "Not found on the web; ask the room." });
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
            content: `${brief(artist, opts.audience)}\nStarting from ${opts.from.label}. Shows wanted: ${shows}.${draw ? ` Usual crowd: about ${draw}.` : ""}\n\nCandidate cities from Qloo's heatmap for ${artist.name}, strongest first:\n${table(candidates, opts.from)}\n\nShortlist exactly ${shows} cities for the tour (no two closer than ${RADIUS_KM} km; prefer stronger cities, but skip a lone far-off city unless it is clearly stronger than nearer ones), each with a short reason, plus up to 3 alternate city_ids in case a city has no room that fits.`,
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
            content: `${brief(artist, opts.audience)}\nShows wanted: ${shows}.${draw ? ` Usual crowd: about ${draw}. Capacities are checked on the web after you book; a room's popularity is a rough guide to its size, so prefer well-known rooms over tiny ones for a crowd this size.` : " Crowd size unknown: a room's popularity is a rough guide to its size."}\n\nScouting results (rooms and openers from Qloo for ${artist.name}'s fans):\n${JSON.stringify(evidence)}\n\nBook exactly ${shows} stops. For each: city_id, room_id from that city's rooms (a real music room: club, hall or theatre, not a festival, gallery or restaurant), opener_id from that city's openers (a different opener in each city where possible), and "why": one natural sentence a manager would read, on why this city and this room, citing one or two figures (for example "Seattle is ${artist.name}'s #2 city on Qloo, and Barboza's crowd matches these fans at 84"). Don't list every field. Use an alternate city only when a shortlisted city has no room that fits.`,
          },
        ],
      });
      model = book.model;
      booked = book.data.stops ?? [];
      if (process.env.ROUTED_DEBUG) console.log("[plan] book", JSON.stringify(booked).slice(0, 1200));
      log({ kind: "model", text: `Booked ${booked.length} stops: a room and an opener in each.`, result: booked.map((s) => byId.get(s.city_id)?.name ?? s.city_id).join(", "), ms: Date.now() - t3 });
    } catch (e) {
      console.error("[plan] model failed, using the fixed plan", e);
      log({ kind: "model", text: "The agent model didn't answer in time, so the fixed plan takes over.", failed: true });
      booked = null;
      model = undefined;
    }
  }

  // Guard the model's answer: real candidates only, no duplicates, radius clause, the right count.
  const chosen: { score: CityScore; why?: string; roomId?: string; openerId?: string }[] = [];
  for (const s of booked ?? []) {
    const score = byId.get(s.city_id);
    if (!score || chosen.some((c) => c.score.marketId === score.marketId)) continue;
    if (chosen.some((c) => km(c.score, score) < RADIUS_KM)) continue;
    chosen.push({ score, why: s.why, roomId: s.room_id, openerId: s.opener_id });
    if (chosen.length >= shows) break;
  }
  const planned = chosen.length ? "model" : "fixed";

  // Fill from the ranking (the whole plan when there's no model), skipping cities with no rooms at all.
  const before = chosen.length;
  for (const c of pickCities(candidates.map((score) => ({ market: score, score })), candidates.length)) {
    if (chosen.length >= shows) break;
    if (chosen.some((x) => x.score.marketId === c.score.marketId || km(x.score, c.score) < RADIUS_KM)) continue;
    if (!(await getRooms(c.score.marketId)).length) continue;
    chosen.push({ score: c.score });
  }
  if (planned === "fixed") log({ kind: "rule", text: `Fixed plan: the ${chosen.length} strongest cities at least ${RADIUS_KM} km apart that have rooms.`, result: chosen.map((c) => c.score.name).join(", ") });
  else if (chosen.length > before) log({ kind: "rule", text: `The agent booked ${before} usable stops; the ranking filled the other ${chosen.length - before}.`, result: chosen.slice(before).map((c) => c.score.name).join(", ") });

  // Every picked city gets its lookups, whatever the model skipped. The booked room's capacity is checked on the
  // web; with a known crowd, a room that misses it is swapped for the next one that fits (at most two more checks).
  const picks = await Promise.all(
    chosen.map(async (c): Promise<Pick> => {
      const [r, o] = await Promise.all([getRooms(c.score.marketId), getOpeners(c.score.marketId)]);
      const first = r.find((x) => x.id === c.roomId) ?? r[0];
      if (first) await measure(first, c.score.name);
      if (draw && first && (fit(first, draw) === "too small" || fit(first, draw) === "too big")) {
        for (const next of r.filter((x) => x !== first).slice(0, 2)) {
          await measure(next, c.score.name);
          if (fit(next, draw) === "fits") break;
        }
      }
      return {
        marketId: c.score.marketId,
        rooms: r,
        roomId: roomFor(r, c.roomId ?? first?.id, draw, log, c.score.name),
        openers: o,
        openerId: o.some((x) => x.id === c.openerId) ? c.openerId : undefined,
        why: c.why,
      };
    }),
  );
  spreadOpeners(picks);
  return { picks, planned, model };
}

/** The model's room, unless its known capacity misses the crowd and the city has a room that fits (rule beats model). */
function roomFor(rooms: Room[], wanted: string | undefined, draw: number | undefined, log: Log, city: string): string | undefined {
  const pick = rooms.find((x) => x.id === wanted);
  if (!pick) return bestRoom(rooms, draw)?.id;
  const f = fit(pick, draw);
  if (f === "too small" || f === "too big") {
    const better = rooms.find((x) => fit(x, draw) === "fits");
    if (better) {
      log({ kind: "rule", text: `${pick.name} holds ${pick.capacity!.value.toLocaleString("en-US")}, ${f} for a crowd of about ${draw!.toLocaleString("en-US")}, so ${city} gets ${better.name}.`, result: `${better.name} holds ${better.capacity!.value.toLocaleString("en-US")}` });
      return better.id;
    }
  }
  return pick.id;
}

/** Without the model: the strongest affinity among rooms that fit the crowd, when capacities are known. */
export function bestRoom(rooms: Room[], draw?: number): Room | undefined {
  if (draw) {
    const ok = rooms.find((r) => fit(r, draw) === "fits");
    if (ok) return ok;
  }
  return rooms[0];
}

/** One opener per stop where possible: keep the model's choice, else the best one not already used. */
function spreadOpeners(picks: Pick[]) {
  const used = new Set(picks.map((p) => p.openerId).filter(Boolean));
  for (const p of picks) {
    if (p.openerId) continue;
    const next = p.openers.find((o) => !used.has(o.id)) ?? p.openers[0];
    if (next) {
      p.openerId = next.id;
      used.add(next.id);
    }
  }
}
