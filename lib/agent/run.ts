import "server-only";
import { findMarket, marketId, marketLabel, REGIONS } from "../geo/markets";
import { orderStops, schedule } from "../geo/route";
import { modelLabel } from "../nebius";
import { describeRequest, search, wherePopular, type Entity } from "../qloo";
import type { Artist, CityScore, Engine, LogLine, Plan, Stop, TourInput } from "../types";
import { buildDossier } from "./dossier";
import { HEAT_AREAS, scoreCities, strength, type HeatTile } from "./cities";
import { checkNumbers, evidenceLines, room } from "./evidence";
import { writePitches } from "./pitch";
import { askWithoutQloo, scoreGuess } from "./guess";
import { planTour } from "./plan";
import { lookUpSpots } from "./tools";

/**
 * One routing run, as a stream of events the page renders as they arrive:
 * find the artist → where their fans over-index (heatmap) + who they are (demographics, taste, trend) →
 * the agent picks cities, rooms and openers → rules route and date it → capacities from the web → pitches.
 */
export type Event = { t: "log"; line: LogLine } | { t: "plan"; plan: Partial<Plan> } | { t: "done"; at: string; engine: Engine } | { t: "error"; message: string };

const now = () => new Date().toISOString();

function channel<T>() {
  const buf: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(v: T) {
      buf.push(v);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *drain(): AsyncGenerator<T> {
      while (true) {
        if (buf.length) {
          yield buf.shift()!;
          continue;
        }
        if (closed) return;
        await new Promise<void>((r) => (wake = r));
        wake = null;
      }
    },
  };
}

const toArtist = (e: Entity): Artist => ({
  id: e.id,
  name: e.name,
  image: e.image,
  description: e.description,
  disambiguation: e.disambiguation,
  popularity: e.popularity,
  genres: e.tags.filter((t) => /genre/.test(t.type ?? t.id)).map((t) => t.name).slice(0, 5),
});

export async function* runTour(input: TourInput, useModel: boolean): AsyncGenerator<Event> {
  const ch = channel<Event>();
  const engine: Engine = { planned: useModel ? "model" : "fixed" };
  const log = (l: Omit<LogLine, "at">) => ch.push({ t: "log", line: { at: now(), ...l } });
  const fail = (message: string) => {
    ch.push({ t: "error", message });
    ch.close();
  };

  (async () => {
    // 1. Who and from where.
    const home = findMarket(input.from);
    if (!home) return fail(`Routed doesn't know “${input.from}” as a city yet. Try a nearby bigger city, like “Portland, OR” or “Manchester, UK”.`);
    const region = home.region;
    let t = Date.now();
    const found = await search(input.artist, "urn:entity:artist", 5).catch((e: Error) => fail(`Qloo search failed: ${e.message}`));
    if (!found) return;
    const best = found.entities[0];
    log({ kind: "qloo", text: `Who is “${input.artist}” on Qloo?`, result: best ? `${best.name}${best.disambiguation ? ` (${best.disambiguation})` : ""}` : "No artist by that name.", request: describeRequest(found.request), ms: Date.now() - t });
    if (!best) return fail(`Qloo has no artist called “${input.artist}”. Check the spelling, or try the name as it appears on streaming services.`);
    const artist = toArtist(best);
    const from = { marketId: marketId(home), label: marketLabel(home), lat: home.lat, lon: home.lon };
    ch.push({ t: "plan", plan: { artist, region, from, firstDate: input.firstDate } });

    // The control group starts now: the same model, no Qloo. Scored once Routed's tour exists.
    const guessP = useModel ? askWithoutQloo(artist, marketLabel(home), region, input.shows, input.draw) : Promise.resolve(null);
    if (useModel) log({ kind: "model", text: `Asked the model alone, with no Qloo, to route the same ${input.shows} shows (the control group).` });

    // 2. Where the fans are, and who they are, in parallel.
    const heatP = Promise.all(
      HEAT_AREAS[region].map(async (area) => {
        const t0 = Date.now();
        try {
          const r = await wherePopular(artist.id, area.within, 50);
          log({ kind: "qloo", text: `Where do ${artist.name} fans over-index in ${area.name}?`, result: `${r.tiles.length} heatmap tiles`, request: describeRequest(r.request), ms: Date.now() - t0 });
          return r.tiles;
        } catch (e) {
          log({ kind: "qloo", text: `Where do ${artist.name} fans over-index in ${area.name}?`, result: (e as Error).message, failed: true });
          return [] as HeatTile[];
        }
      }),
    ).then((l) => l.flat());

    const audP = buildDossier(artist, log);

    const tiles = await heatP;
    const cities: CityScore[] = scoreCities(tiles, region);
    log({ kind: "rule", text: `Heatmap tiles placed in their cities (a market is a city of 50k+ with its suburbs).`, result: cities.length ? `${cities.length} cities; strongest: ${cities.slice(0, 4).map((c) => c.name).join(", ")}` : "No tile fell inside a touring city." });
    // The poster needs the hot spots, not all ~6,000 tiles: keep the strongest 700 (a few KB, not half a MB).
    const heat = [...tiles]
      .sort((a, b) => strength(b) - strength(a))
      .slice(0, 700)
      .map((x) => ({ lat: +x.lat.toFixed(3), lon: +x.lon.toFixed(3), affinity: +x.affinity.toFixed(4), popularity: x.popularity === undefined ? undefined : +x.popularity.toFixed(4) }));
    ch.push({ t: "plan", plan: { heat, cities } });
    if (cities.length < 2) return fail(`Qloo's heatmap didn't show enough ${REGIONS[region].name} cities for ${artist.name} to route a tour. Try a starting city in another region, or a better-known artist.`);
    const audience = await audP;
    ch.push({ t: "plan", plan: { audience } });

    // 3. The agent picks cities, rooms and openers.
    const shows = Math.min(input.shows, cities.length);
    const picked = await planTour({ artist, audience, cities, from, shows, draw: input.draw, useModel, log });
    engine.planned = picked.planned;
    if (picked.model) engine.agent = modelLabel(picked.model);

    // 4. Rules route and date it.
    const byId = new Map(cities.map((c) => [c.marketId, c]));
    const pts = picked.picks.map((p) => ({ ...p, lat: byId.get(p.marketId)!.lat, lon: byId.get(p.marketId)!.lon }));
    const legs = schedule(from, orderStops(from, pts), input.firstDate);
    const totalKm = legs.reduce((s, l) => s + l.fromKm, 0);
    log({ kind: "rule", text: "Routed the shortest drive from the starting city and put it on the calendar.", result: `${legs.length} shows, ${legs[0]?.date} to ${legs.at(-1)?.date}, about ${totalKm.toLocaleString("en-US")} km of road` });

    const stops: Stop[] = legs.map((l) => {
      const score = byId.get(l.stop.marketId)!;
      return {
        marketId: score.marketId,
        city: score.name,
        label: score.label,
        lat: score.lat,
        lon: score.lon,
        date: l.date,
        fromKm: l.fromKm,
        fromHours: l.fromHours,
        travelDays: l.travelDays,
        dayOff: l.dayOff,
        score,
        why: l.stop.why,
        rooms: l.stop.rooms,
        roomId: l.stop.roomId,
        openers: l.stop.openers,
        openerId: l.stop.openerId,
        after: [],
      };
    });
    const plan: Plan = { artist, region, from, firstDate: input.firstDate, lastDate: legs.at(-1)?.date ?? input.firstDate, heat, cities, stops, totalKm, audience };
    ch.push({ t: "plan", plan });

    // 5. The advance from Qloo, per stop, in parallel: where to put posters up, and where fans go after.
    await Promise.all(
      stops.map(async (s) => {
        const skip = s.rooms.map((x) => x.id);
        const [after, posters] = await Promise.all([lookUpSpots("after", artist, s.marketId, log, skip), lookUpSpots("posters", artist, s.marketId, log, skip)]);
        s.after = after;
        s.posters = posters;
      }),
    );
    for (const s of stops) if (s.why) s.why = checkNumbers(s.why, evidenceLines(plan, s)).text;
    ch.push({ t: "plan", plan });

    const raw = await guessP;
    if (raw?.stops.length) {
      plan.guess = await scoreGuess({ artist, region, cities, stops, raw, log });
      ch.push({ t: "plan", plan });
    } else if (useModel) log({ kind: "model", text: "The model-alone tour didn't come back, so there's no comparison this time.", failed: true });

    // 6. A pitch for every room.
    t = Date.now();
    const pitched = await writePitches(plan, useModel && picked.planned === "model");
    if (pitched.model) engine.writer = modelLabel(pitched.model);
    stops.forEach((s, i) => (s.pitch = pitched.pitches[i]));
    const struck = pitched.pitches.reduce((n, p) => n + p.struck.length, 0);
    log({ kind: pitched.model ? "model" : "rule", text: `Drafted ${stops.length} hold requests from each stop's evidence.`, result: struck ? `${struck} figure${struck === 1 ? "" : "s"} not in the evidence ${struck === 1 ? "was" : "were"} struck` : "Every figure checked against the evidence", ms: Date.now() - t });
    ch.push({ t: "plan", plan });
    ch.push({ t: "done", at: now(), engine });
    ch.close();
  })().catch((e) => {
    console.error("[run] failed", e);
    fail("The routing stopped partway. Run it again in a minute.");
  });

  yield* ch.drain();
}
