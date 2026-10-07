import "server-only";
import { findMarket, marketId, marketLabel, REGIONS, type RegionId } from "../geo/markets";
import { RADIUS_KM } from "../geo/route";
import { MODELS, structured } from "../nebius";
import { describeRequest, qlooGet, search } from "../qloo";
import type { Artist, CityScore, Guess, GuessStop, Plan, Stop } from "../types";
import type { Log } from "./tools";

/**
 * The control group. The same model, asked the same question with no Qloo: "route this tour from what you know."
 * Its cities are then scored on the artist's own Qloo heatmap and its rooms on Qloo's fan affinity, side by side
 * with Routed's, so anyone can see what the taste graph changed (the hackathon asks for agents that beat
 * LLM-only approaches; this measures it on every tour instead of claiming it).
 */

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    stops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { city: { type: "string" }, area: { type: "string" }, venue: { type: "string" } },
        required: ["city", "area", "venue"],
      },
    },
  },
  required: ["stops"],
};

const SYSTEM = `You are an experienced booking agent. Plan a headline tour for an artist using only your own knowledge of the artist, the cities and the rooms.
Rules: exactly the number of shows asked for, one per city, no two cities within ${RADIUS_KM} km of each other, all in the region given. For each show give the city, its state, province or country, and the venue you would book for this artist's audience size.
Reply as JSON only.`;

/** Asks the model alone for a tour. Starts as soon as the artist is known, in parallel with the real run. */
export async function askWithoutQloo(artist: Artist, from: string, region: RegionId, shows: number, draw?: number): Promise<{ stops: { city: string; area: string; venue: string }[]; model: string } | null> {
  try {
    const { data, model } = await structured<{ stops: { city: string; area: string; venue: string }[] }>(MODELS.agent, {
      name: "tour",
      schema: SCHEMA,
      maxTokens: 1500,
      timeoutMs: 60_000,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Artist: ${artist.name}${artist.disambiguation ? ` (${artist.disambiguation})` : ""}.\nRegion: ${REGIONS[region].name}.\nStarting from: ${from}.\nShows: ${shows}.${draw ? `\nUsual crowd: about ${draw}.` : ""}` },
      ],
    });
    return { stops: (data.stops ?? []).filter((s) => s?.city).slice(0, shows), model };
  } catch (e) {
    console.error("[guess] model failed", e);
    return null;
  }
}

/**
 * Scores the model-alone tour against the same evidence Routed used: each city's fan affinity on the artist's
 * Qloo heatmap (a city with no tile at all scores nothing), and every room, theirs and ours, in one Qloo call
 * restricted to exactly those rooms, so both sides are measured on the same scale.
 */
export async function scoreGuess(opts: { artist: Artist; region: RegionId; cities: CityScore[]; stops: Stop[]; raw: { stops: { city: string; area: string; venue: string }[]; model: string }; log: Log }): Promise<Guess> {
  const { artist, region, cities, stops, raw, log } = opts;
  const byId = new Map(cities.map((c) => [c.marketId, c]));
  const t = Date.now();

  const guessed: GuessStop[] = await Promise.all(
    raw.stops.map(async (s): Promise<GuessStop> => {
      const m = findMarket(`${s.city}, ${s.area}`, region);
      const score = m ? byId.get(marketId(m)) : undefined;
      const out: GuessStop = { city: s.city, label: m ? marketLabel(m) : `${s.city}, ${s.area}`, marketId: m ? marketId(m) : undefined, affinity: score?.affinity, rank: score?.rank, venue: s.venue };
      // Resolve the named room on Qloo; keep it only if Qloo's match is in that city.
      const found = await search(`${s.venue} ${s.city}`, "urn:entity:place", 3).catch(() => null);
      const hit = found?.entities.find((e) => sameCity(e.place?.city ?? e.place?.address ?? e.disambiguation ?? "", s.city));
      if (hit) out.venueId = hit.id;
      return out;
    }),
  );

  // One call scores every room on both sides against this artist's fans.
  const routedRooms = stops.map((s) => s.rooms.find((r) => r.id === s.roomId) ?? s.rooms[0]).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const ids = [...new Set([...routedRooms.map((r) => r.id), ...guessed.map((g) => g.venueId).filter((x): x is string => Boolean(x))])];
  const roomAffinity = new Map<string, number>();
  if (ids.length) {
    try {
      const { body, request } = await qlooGet<{ results?: { entities?: { entity_id: string; query?: { affinity?: number } }[] } }>("/v2/insights", {
        "filter.type": "urn:entity:place",
        "signal.interests.entities": artist.id,
        "filter.results.entities": ids.join(","),
        take: Math.min(50, ids.length),
      });
      for (const e of body.results?.entities ?? []) if (typeof e.query?.affinity === "number") roomAffinity.set(e.entity_id, e.query.affinity);
      log({ kind: "qloo", text: `How strongly do ${artist.name} fans match each room, Routed's and the model-alone tour's?`, result: `${roomAffinity.size} of ${ids.length} rooms scored`, request: describeRequest(request), ms: Date.now() - t });
    } catch (e) {
      log({ kind: "qloo", text: `How strongly do ${artist.name} fans match each room?`, result: (e as Error).message, failed: true });
    }
  }
  for (const g of guessed) if (g.venueId) g.venueAffinity = roomAffinity.get(g.venueId);
  const routedRoomAffinity = Object.fromEntries(routedRooms.map((r) => [r.id, roomAffinity.get(r.id) ?? r.affinity]).filter(([, v]) => v !== undefined)) as Record<string, number>;

  const mean = (xs: (number | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  };
  const guess: Guess = {
    model: raw.model,
    stops: guessed,
    cityMean: { routed: mean(stops.map((s) => s.score.affinity)), guess: mean(guessed.map((g) => g.affinity ?? 0)) },
    rankMean: { routed: mean(stops.map((s) => s.score.rank)), guess: mean(guessed.map((g) => g.rank ?? cities.length + 1)) },
    ranked: cities.length,
    roomMean: { routed: mean(Object.values(routedRoomAffinity)), guess: mean(guessed.map((g) => g.venueAffinity)) },
    routedRoomAffinity,
    shared: guessed.filter((g) => g.marketId && stops.some((s) => s.marketId === g.marketId)).length,
    unscored: guessed.filter((g) => g.affinity === undefined).length,
  };
  log({
    kind: "rule",
    text: "Scored the model-alone tour on the same Qloo evidence.",
    result: `Average city rank on the heatmap: model alone #${Math.round(guess.rankMean.guess ?? 0)}, Routed #${Math.round(guess.rankMean.routed ?? 0)} of ${cities.length}; ${guess.shared} of ${guessed.length} cities in common`,
  });
  return guess;
}

const pct = (v?: number) => (v === undefined ? "–" : String(Math.round(v * 100)));

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

function sameCity(where: string, city: string): boolean {
  const w = fold(where), c = fold(city).replace(/^(new york city|nyc)$/, "new york");
  return w.includes(c) || (c === "new york" && /brooklyn|manhattan|queens/.test(w));
}

/**
 * Re-matches a stored model-alone tour's cities to markets and recomputes the totals, without calling Qloo or the
 * model again. Used when city matching improves (St. Louis once failed to match and counted as "no fans").
 */
export function rescore(plan: Plan): Guess | undefined {
  const g = plan.guess;
  if (!g) return undefined;
  const byId = new Map(plan.cities.map((c) => [c.marketId, c]));
  const stops = g.stops.map((s) => {
    if (s.marketId) return s;
    const m = findMarket(s.label, plan.region);
    if (!m) return s;
    const score = byId.get(marketId(m));
    return { ...s, label: marketLabel(m), marketId: marketId(m), affinity: score?.affinity, rank: score?.rank };
  });
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  return {
    ...g,
    stops,
    cityMean: { routed: g.cityMean.routed, guess: mean(stops.map((x) => x.affinity ?? 0)) },
    rankMean: { routed: g.rankMean.routed, guess: mean(stops.map((x) => x.rank ?? plan.cities.length + 1)) },
    shared: stops.filter((x) => x.marketId && plan.stops.some((s) => s.marketId === x.marketId)).length,
    unscored: stops.filter((x) => x.affinity === undefined).length,
  };
}
