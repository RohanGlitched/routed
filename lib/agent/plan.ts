import "server-only";
import { km } from "../geo/markets";
import { pickCities, RADIUS_KM } from "../geo/route";
import { chat, MODELS, parseJson, type Msg, type ToolDef } from "../nebius";
import type { Artist, Audience, CityScore, Opener, Room } from "../types";
import { AGE_LABEL, topAge } from "./audience";
import { lookUpOpeners, lookUpRooms, type Log } from "./tools";

/**
 * The agent: Nemotron chooses which cities to put on the tour from Qloo's ranked heatmap, looks up rooms and
 * openers for each through Qloo, swaps a city when its rooms don't fit, and picks one room and one opener per
 * stop. Rules hold it in (Playbook L1/L2): cities must come from the candidates, the radius clause is enforced,
 * every picked city gets its room lookup even if the model skipped it, and any gap is filled from the ranking.
 * Without the model (no key, budget spent, or it fails) the same steps run as a fixed plan.
 */

export type Pick = { marketId: string; rooms: Room[]; roomId?: string; openers: Opener[]; openerId?: string; why?: string };

type FinishStop = { city_id: string; room_id?: string; opener_id?: string; why?: string };

export type PlanResult = { picks: Pick[]; planned: "model" | "fixed"; model?: string };

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "look_up_rooms",
      description: "Ask Qloo which music venues in a candidate city the artist's fans go to, ranked by audience affinity. Returns up to 6 rooms with id, name, affinity (0-100) and popularity.",
      parameters: { type: "object", properties: { city_id: { type: "string", description: "A city id from the candidate table." } }, required: ["city_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "look_up_openers",
      description: "Ask Qloo which artists (no bigger than the headliner) share this audience, weighted to the city's local taste. Returns up to 5 with id, name and affinity (0-100).",
      parameters: { type: "object", properties: { city_id: { type: "string" } }, required: ["city_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Submit the tour: exactly the number of shows asked for, one entry per city, each with a room and opener id from your lookups and a one-sentence reason that cites the evidence.",
      parameters: {
        type: "object",
        properties: {
          stops: {
            type: "array",
            items: {
              type: "object",
              properties: { city_id: { type: "string" }, room_id: { type: "string" }, opener_id: { type: "string" }, why: { type: "string" } },
              required: ["city_id", "room_id", "why"],
            },
          },
        },
        required: ["stops"],
      },
    },
  },
];

const SYSTEM = `You are a booking agent routing a tour for an independent artist. Your evidence is Qloo's taste graph: a heatmap of where the artist's fans over-index, and per-city lookups of rooms and openers.

How to work:
- Choose exactly the number of cities asked for from the candidate table. Prefer higher fan affinity, but a tour must also make geographic sense: skip a lone far-off city unless its affinity is clearly higher than nearby alternatives.
- Radius clause: never pick two cities closer than ${RADIUS_KM} km; the table marks pairs that are too close.
- Call look_up_rooms for every city you intend to pick (you may call several tools in one turn). If a city returns no suitable rooms, replace it with the next good candidate and look that one up.
- Call look_up_openers for the cities you pick. Prefer a different opener in each city where the evidence allows.
- Pick the room with the strongest affinity that suits the audience size (a headliner with modest popularity should not be put in an arena).
- When every city has its room and opener, call finish. Each "why" is one plain sentence and may only use numbers from the evidence.`;

function table(cities: CityScore[], from: { lat: number; lon: number }): string {
  const rows = cities.map((c) => `${c.marketId} | ${c.label} | rank ${c.rank} | affinity ${Math.round(c.affinity * 100)}${c.popularity !== undefined ? ` | popularity ${Math.round(c.popularity * 100)}` : ""} | ${Math.round(km(from, c))} km from start`);
  const close: string[] = [];
  for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) if (km(cities[i]!, cities[j]!) < RADIUS_KM) close.push(`${cities[i]!.marketId} ~ ${cities[j]!.marketId}`);
  return `city_id | city | heatmap rank | fan affinity (0-100) | popularity | distance\n${rows.join("\n")}${close.length ? `\n\nToo close to pair (radius clause): ${close.join("; ")}` : ""}`;
}

function brief(artist: Artist, audience: Audience): string {
  const top = topAge(audience.age);
  return [
    `Artist: ${artist.name}${artist.genres.length ? ` (${artist.genres.slice(0, 4).join(", ")})` : ""}${artist.popularity !== undefined ? `, Qloo popularity percentile ${Math.round(artist.popularity * 100)}` : ""}.`,
    top ? `Fans over-index most at ages ${AGE_LABEL[top.bucket]}.` : "",
    audience.tags.length ? `Fans also love: ${audience.tags.slice(0, 6).map((t) => t.name).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const compactRooms = (rooms: Room[]) => rooms.map((r) => ({ id: r.id, name: r.name, affinity: r.affinity === undefined ? null : Math.round(r.affinity * 100), popularity: r.popularity === undefined ? null : Math.round(r.popularity * 100), address: r.address ?? null }));
const compactOpeners = (o: Opener[]) => o.map((x) => ({ id: x.id, name: x.name, affinity: x.affinity === undefined ? null : Math.round(x.affinity * 100) }));

export async function planTour(opts: { artist: Artist; audience: Audience; cities: CityScore[]; from: { lat: number; lon: number; label: string }; shows: number; useModel: boolean; log: Log }): Promise<PlanResult> {
  const { artist, cities, shows, log } = opts;
  const candidates = cities.slice(0, Math.max(shows * 2 + 4, 16));
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

  // Held in an object: it's set from inside the tool callbacks.
  const out: { stops: FinishStop[] | null } = { stops: null };
  let model: string | undefined;

  if (opts.useModel) {
    try {
      const msgs: Msg[] = [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `${brief(artist, opts.audience)}\nStarting from ${opts.from.label}. Shows wanted: ${shows}.\n\nCandidate cities from Qloo's heatmap (strongest first):\n${table(candidates, opts.from)}`,
        },
      ];
      for (let turn = 0; turn < 7 && !out.stops; turn++) {
        const r = await chat(MODELS.agent, { messages: msgs, tools: TOOLS, tool_choice: turn === 6 ? { type: "function", function: { name: "finish" } } : "auto", max_tokens: 2500 }, 45_000);
        model = r.model;
        if (!r.toolCalls.length) {
          // Some replies put the finish JSON in content instead of a tool call.
          try {
            const j = parseJson<{ stops?: FinishStop[] }>(r.content);
            if (j.stops?.length) out.stops = j.stops;
          } catch {
            msgs.push({ role: "assistant", content: r.content }, { role: "user", content: "Use the tools: look up rooms for the cities you want, then call finish." });
          }
          continue;
        }
        msgs.push({ role: "assistant", content: r.content || null, tool_calls: r.toolCalls });
        const results = await Promise.all(
          r.toolCalls.map(async (call) => {
            let args: { city_id?: string; stops?: FinishStop[] } = {};
            try {
              args = JSON.parse(call.function.arguments || "{}");
            } catch {
              /* answered below */
            }
            const id = args.city_id ?? "";
            if (call.function.name === "finish") {
              out.stops = (args.stops ?? []).filter((s) => s && typeof s.city_id === "string");
              return { call, content: "Received." };
            }
            if (!candidates.some((c) => c.marketId === id)) return { call, content: JSON.stringify({ error: `${id} is not in the candidate table.` }) };
            if (call.function.name === "look_up_rooms") return { call, content: JSON.stringify({ city_id: id, rooms: compactRooms(await getRooms(id)) }) };
            if (call.function.name === "look_up_openers") return { call, content: JSON.stringify({ city_id: id, openers: compactOpeners(await getOpeners(id)) }) };
            return { call, content: JSON.stringify({ error: "Unknown tool." }) };
          }),
        );
        for (const { call, content } of results) msgs.push({ role: "tool", tool_call_id: call.id, content });
      }
    } catch (e) {
      console.error("[plan] model failed, using the fixed plan", e);
      log({ kind: "model", text: "The agent model didn't answer, so the fixed plan takes over.", failed: true });
      out.stops = null;
      model = undefined;
    }
  }

  // Guard the model's answer: real candidates only, no duplicates, radius clause, the right count.
  const chosen: { score: CityScore; why?: string; roomId?: string; openerId?: string }[] = [];
  for (const s of out.stops ?? []) {
    const score = candidates.find((c) => c.marketId === s.city_id);
    if (!score || chosen.some((c) => c.score.marketId === score.marketId)) continue;
    if (chosen.some((c) => km(c.score, score) < RADIUS_KM)) continue;
    chosen.push({ score, why: s.why, roomId: s.room_id, openerId: s.opener_id });
    if (chosen.length >= shows) break;
  }
  const planned = out.stops && chosen.length ? "model" : "fixed";
  if (planned === "model") log({ kind: "model", text: `The agent picked ${chosen.length} cities.`, result: chosen.map((c) => c.score.name).join(", ") });

  // Fill from the ranking (the whole plan when there's no model), skipping cities with no rooms at all.
  for (const c of pickCities(candidates.map((score) => ({ market: score, score })), candidates.length)) {
    if (chosen.length >= shows) break;
    if (chosen.some((x) => x.score.marketId === c.score.marketId || km(x.score, c.score) < RADIUS_KM)) continue;
    if (!(await getRooms(c.score.marketId)).length) continue;
    chosen.push({ score: c.score });
  }
  if (planned === "fixed") log({ kind: "rule", text: `Fixed plan: the ${chosen.length} strongest cities at least ${RADIUS_KM} km apart that have rooms.`, result: chosen.map((c) => c.score.name).join(", ") });

  // Every picked city gets its lookups, whatever the model skipped.
  const picks = await Promise.all(
    chosen.map(async (c): Promise<Pick> => {
      const [r, o] = await Promise.all([getRooms(c.score.marketId), getOpeners(c.score.marketId)]);
      return {
        marketId: c.score.marketId,
        rooms: r,
        roomId: r.some((x) => x.id === c.roomId) ? c.roomId : r[0]?.id,
        openers: o,
        openerId: o.some((x) => x.id === c.openerId) ? c.openerId : undefined,
        why: c.why,
      };
    }),
  );
  spreadOpeners(picks);
  return { picks, planned, model };
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

