import "server-only";
import { findMarket, marketId, marketLabel, REGIONS } from "../geo/markets";
import { MAX_LEG_KM, orderStops, schedule } from "../geo/route";
import { modelLabel, MODELS, structured, withDeadline } from "../nebius";
import { describeRequest, search, type Entity } from "../qloo";
import { cachedWherePopular } from "../heatcache";
import { assumeDraw } from "../draw";
import type { Artist, CityScore, Engine, LogLine, Plan, ReadThrough, Stop, TourInput } from "../types";
import { roomCapacity } from "../web";
import { buildDossier } from "./dossier";
import { HEAT_AREAS, scoreCities, strength, type HeatTile } from "./cities";
import { checkWhy, room } from "./evidence";
import { writePitches } from "./pitch";
import { askWithoutQloo, scoreGuess } from "./guess";
import { planTour, type Ask, type PlanDeps } from "./plan";
import { lookUpLocal, lookUpShared, placeLocal } from "./local";
import { genresOf, pickArtist } from "./rooms";
import { findPlace, ladderRooms, lookUpOpeners, lookUpRooms, lookUpSoundsLike, lookUpSpots, scoreRooms } from "./tools";
import { newUsage, withUsage } from "../usage";
import { addDays } from "../geo/route";

/**
 * One routing run, as a stream of events the page renders as they arrive:
 * find the artist → where their fans over-index (heatmap) + who they are (demographics, taste, trend) →
 * the agent picks cities, rooms and one support act → rules route and date it → capacities from the web → pitches.
 */
export type Event = { t: "log"; line: LogLine } | { t: "plan"; plan: Partial<Plan> } | { t: "done"; at: string; engine: Engine } | { t: "error"; message: string };

const now = () => new Date().toISOString();

/**
 * The run-wide deadline (L6): the function is stopped at 300 s, so every model call has to be done by 240 s, and
 * the agent's planning calls by 160 s, leaving the fixed plan, the advance lookups and the pitches time to finish.
 */
export const RUN_DEADLINE_MS = 240_000;
export const PLAN_DEADLINE_MS = 160_000;

/**
 * A heatmap this thin can't route a tour (H10): fewer cities than the shows asked for plus two, or fewer than six.
 * The map is then read through artists who sound like this one.
 */
export const THIN_CITIES = 6;
export const isThin = (cities: CityScore[], shows: number) => cities.length < Math.max(THIN_CITIES, shows + 2);

/** The agent's tools: its model chain, Qloo's per-city lookups and the room capacity reader. */
const AGENT: PlanDeps = { ask: <T,>(o: Parameters<Ask>[0]) => structured<T>(MODELS.agent, o), lookUpRooms, lookUpOpeners, roomCapacity, findPlace, scoreRooms, ladderRooms };

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
  genreKeys: genresOf(e.tags),
});

export async function* runTour(input: TourInput, useModel: boolean): AsyncGenerator<Event> {
  const ch = channel<Event>();
  const usage = newUsage();
  const engine: Engine = { planned: useModel ? "model" : "fixed", usage };
  const log = (l: Omit<LogLine, "at">) => ch.push({ t: "log", line: { at: now(), ...l } });
  const fail = (message: string) => {
    ch.push({ t: "error", message });
    ch.close();
  };

  const started = Date.now();
  withUsage(usage, () => withDeadline(started + RUN_DEADLINE_MS, async () => {
    // 1. Who and from where.
    const home = findMarket(input.from);
    if (!home) return fail(`Routed doesn't know “${input.from}” as a city yet. Try a nearby bigger city, like “Portland, OR” or “Manchester, UK”.`);
    const region = home.region;
    let t = Date.now();
    const found = await search(input.artist, "urn:entity:artist", 5).catch((e: Error) => fail(`Qloo search failed: ${e.message}`));
    if (!found) return;
    const { pick: best, others } = pickArtist(input.artist, found.entities);
    log({ kind: "qloo", text: `Who is “${input.artist}” on Qloo?`, result: best ? `${best.name}${best.disambiguation ? ` (${best.disambiguation})` : ""}${others.length ? `; also found ${others.map((o) => o.name).join(", ")}` : ""}` : "No artist by that name.", request: describeRequest(found.request), ms: Date.now() - t });
    if (!best) return fail(`Qloo has no artist called “${input.artist}”. Check the spelling, or try the name as it appears on streaming services.`);
    const artist = toArtist(best);
    // Crowd left at "Not sure" (H7): a draw assumed from Qloo popularity sizes the rooms, and the tour says so.
    const assumedDraw = input.draw ? undefined : assumeDraw(artist.popularity);
    const draw = input.draw ?? assumedDraw;
    if (others.length) artist.others = others.map((o) => ({ name: o.name, ...(o.disambiguation ? { disambiguation: o.disambiguation } : {}) }));
    const from = { marketId: marketId(home), label: marketLabel(home), lat: home.lat, lon: home.lon };
    ch.push({ t: "plan", plan: { artist, region, from, firstDate: input.firstDate } });

    // The control group starts now: the same model, no Qloo. Scored once Routed's tour exists.
    const guessP = useModel ? askWithoutQloo(artist, marketLabel(home), region, input.shows, draw) : Promise.resolve(null);
    if (useModel) log({ kind: "model", text: `Asked the model alone, with no Qloo, to route the same ${input.shows} shows (the control group).` });

    // 2. Where the fans are, and who they are, in parallel.
    const heatP = Promise.all(
      HEAT_AREAS[region].map(async (area) => {
        const t0 = Date.now();
        try {
          const r = await cachedWherePopular(artist.id, area.within, 50);
          log({ kind: "qloo", text: `Where do ${artist.name} fans over-index in ${area.name}?`, result: `${r.tiles.length} heatmap tiles${r.storedAt ? " (stored copy)" : ""}`, request: describeRequest(r.request), ms: Date.now() - t0 });
          return r.tiles;
        } catch (e) {
          log({ kind: "qloo", text: `Where do ${artist.name} fans over-index in ${area.name}?`, result: (e as Error).message, failed: true });
          return [] as HeatTile[];
        }
      }),
    ).then((l) => l.flat());

    const audP = buildDossier(artist, log);

    let tiles = await heatP;
    let cities: CityScore[] = scoreCities(tiles, region);
    log({ kind: "rule", text: `Heatmap tiles placed in their cities (a market is a city of 50k+ with its suburbs).`, result: cities.length ? `${cities.length} cities; strongest: ${cities.slice(0, 4).map((c) => c.name).join(", ")}` : "No tile fell inside a touring city." });

    // An act too new for its own map is read through two or three artists who sound like it, sent together as
    // one taste signal; the tour book says whose map it is.
    let readThrough: ReadThrough[] | undefined;
    let triedThrough = false;
    if (isThin(cities, input.shows)) {
      const like = await lookUpSoundsLike(artist, log);
      if (like.length >= 2) {
        triedThrough = true;
        const names = like.map((x) => x.name).join(", ").replace(/, ([^,]+)$/, " and $1");
        const through = (
          await Promise.all(
            HEAT_AREAS[region].map(async (area) => {
              const t0 = Date.now();
              try {
                const r = await cachedWherePopular(like.map((x) => x.id).join(","), area.within, 50);
                log({ kind: "qloo", text: `Where do fans of ${names} over-index in ${area.name}?`, result: `${r.tiles.length} heatmap tiles${r.storedAt ? " (stored copy)" : ""}`, request: describeRequest(r.request), ms: Date.now() - t0 });
                return r.tiles;
              } catch (e) {
                log({ kind: "qloo", text: `Where do fans of ${names} over-index in ${area.name}?`, result: (e as Error).message, failed: true });
                return [] as HeatTile[];
              }
            }),
          )
        ).flat();
        const wider = scoreCities(through, region);
        if (wider.length > cities.length) {
          log({ kind: "rule", text: `${artist.name}'s own heatmap shows ${cities.length === 1 ? "one city" : `${cities.length} cities`}, too few to route ${input.shows} shows, so the map is read through ${names}: the cities where audiences like ${artist.name}'s over-index.`, result: `${wider.length} cities; strongest: ${wider.slice(0, 4).map((c) => c.name).join(", ")}` });
          tiles = through;
          cities = wider;
          readThrough = like;
        } else log({ kind: "rule", text: `Reading the map through ${names} found no more cities, so ${artist.name}'s own map stands.` });
      }
    }
    // The poster needs the hot spots, not all ~6,000 tiles: keep the strongest 700 (a few KB, not half a MB).
    const heat = [...tiles]
      .sort((a, b) => strength(b) - strength(a))
      .slice(0, 700)
      .map((x) => ({ lat: +x.lat.toFixed(3), lon: +x.lon.toFixed(3), affinity: +x.affinity.toFixed(4), popularity: x.popularity === undefined ? undefined : +x.popularity.toFixed(4) }));
    ch.push({ t: "plan", plan: { heat, cities, ...(readThrough ? { readThrough } : {}) } });
    if (cities.length < 2) return fail(`Qloo's heatmap didn't show enough ${REGIONS[region].name} cities for ${artist.name} to route a tour${triedThrough ? ", even read through artists who sound like them. Try a starting city in another region." : ". Try a starting city in another region, or a better-known artist."}`);
    const audience = await audP;
    ch.push({ t: "plan", plan: { audience } });

    // 3. The agent picks cities, rooms and openers.
    const shows = Math.min(input.shows, cities.length);
    const picked = await planTour({ artist, audience, cities, from, region, shows, draw, useModel, log, deadline: started + PLAN_DEADLINE_MS }, AGENT);
    engine.planned = picked.planned;
    if (picked.model) engine.agent = modelLabel(picked.model);
    if (picked.check) engine.check = picked.check;

    // 4. Rules route and date it.
    const byId = new Map(cities.map((c) => [c.marketId, c]));
    const pts = picked.picks.map((p) => ({ ...p, lat: byId.get(p.marketId)!.lat, lon: byId.get(p.marketId)!.lon }));
    const legs = schedule(from, orderStops(from, pts.map((p) => ({ ...p, id: p.marketId })), { max: MAX_LEG_KM, first: picked.homeId }), input.firstDate);
    const totalKm = legs.reduce((s, l) => s + l.fromKm, 0);
    log({ kind: "rule", text: "Routed the shortest drive from the starting city and put it on the calendar.", result: `${legs.reduce((n, l) => n + l.nights, 0)} shows in ${legs.length} cities, ${legs[0]?.date} to ${legs.length ? addDays(legs.at(-1)!.date, legs.at(-1)!.nights - 1) : ""}, about ${totalKm.toLocaleString("en-US")} km of road` });

    const stops: Stop[] = legs.map((l) => {
      const score = byId.get(l.stop.marketId)!;
      return {
        marketId: score.marketId,
        city: score.name,
        label: score.label,
        lat: score.lat,
        lon: score.lon,
        date: l.date,
        ...(l.nights > 1 ? { nights: l.nights } : {}),
        fromKm: l.fromKm,
        fromHours: l.fromHours,
        travelDays: l.travelDays,
        dayOff: l.dayOff,
        ...(l.ferry ? { ferry: l.ferry } : {}),
        score,
        why: l.stop.why,
        rooms: l.stop.rooms,
        roomId: l.stop.roomId,
        openers: l.stop.openers,
        openerId: l.stop.openerId,
        ...(l.stop.noRoom ? { noRoom: l.stop.noRoom } : {}),
        after: [],
      };
    });
    const plan: Plan = { artist, region, from, firstDate: input.firstDate, lastDate: legs.length ? addDays(legs.at(-1)!.date, legs.at(-1)!.nights - 1) : input.firstDate, heat, cities, stops, totalKm, audience, ...(picked.qlooDiff ? { qlooDiff: picked.qlooDiff } : {}), ...(picked.tradeOff ? { tradeOff: picked.tradeOff } : {}), ...(readThrough ? { readThrough } : {}), ...(assumedDraw ? { assumedDraw } : {}) };
    ch.push({ t: "plan", plan });

    // 5. The advance from Qloo, per stop, in parallel: the city at street level (which neighbourhood the fans
    //    over-index in, and whether the booked room is there), the poster run anchored on that neighbourhood,
    //    where fans go after, and what the headliner's and the opener's audiences share.
    const sharedMemo = new Map<string, Promise<string[]>>();
    await Promise.all(
      stops.map(async (s) => {
        const skip = s.rooms.map((x) => x.id);
        const booked = room(s);
        const chosenOpener = s.openers.find((o) => o.id === s.openerId) ?? s.openers[0];
        const [local, after, shared] = await Promise.all([
          lookUpLocal(artist, s.marketId, log),
          lookUpSpots("after", artist, s.marketId, log, skip),
          chosenOpener ? (sharedMemo.get(chosenOpener.id) ?? sharedMemo.set(chosenOpener.id, lookUpShared(artist, chosenOpener, log)).get(chosenOpener.id)!) : Promise.resolve([] as string[]),
        ]);
        // Posters go up near the hottest tile when the city has one; the whole city otherwise.
        let posters = await lookUpSpots("posters", artist, s.marketId, log, skip, local?.hot);
        if (local && posters.length < 2) posters = await lookUpSpots("posters", artist, s.marketId, log, skip);
        s.after = after;
        s.posters = posters;
        if (local) s.local = placeLocal(local, booked, [...posters, ...after], s.city, log, s.rooms);
        if (chosenOpener) chosenOpener.shared = shared;
        ch.push({ t: "plan", plan });
      }),
    );
    // The agent writes the reasons after the rules settle, so a clean model sentence is kept; its figures are checked.
    for (const s of stops) if (s.why) s.why = checkWhy(plan, s, draw, { keepModel: true });
    ch.push({ t: "plan", plan });

    const raw = await guessP;
    if (raw?.stops.length) {
      plan.guess = await scoreGuess({ artist, region, cities, stops, raw, log });
      ch.push({ t: "plan", plan });
    } else if (useModel) log({ kind: "model", text: "The model-alone tour didn't come back, so there's no comparison this time.", failed: true });

    // 6. A pitch for every room.
    t = Date.now();
    const pitched = await writePitches(plan, useModel && picked.planned === "model", draw);
    if (pitched.model) engine.writer = modelLabel(pitched.model);
    stops.forEach((s, i) => (s.pitch = pitched.pitches[i]));
    const struck = pitched.pitches.reduce((n, p) => n + p.struck.length, 0);
    log({ kind: pitched.model ? "model" : "rule", text: `Drafted ${stops.length} hold requests from each stop's evidence.`, result: struck ? `${struck} figure${struck === 1 ? "" : "s"} not in the evidence ${struck === 1 ? "was" : "were"} struck` : "Every figure checked against the evidence", ms: Date.now() - t });
    ch.push({ t: "plan", plan });
    ch.push({ t: "done", at: now(), engine });
    ch.close();
  })).catch((e) => {
    console.error("[run] failed", e);
    fail("The routing stopped partway. Run it again in a minute.");
  });

  yield* ch.drain();
}
