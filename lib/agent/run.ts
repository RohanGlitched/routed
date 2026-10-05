import "server-only";
import { findMarket, marketId, marketLabel, REGIONS } from "../geo/markets";
import { orderStops, schedule } from "../geo/route";
import { modelLabel } from "../nebius";
import { demographics, describeRequest, search, tasteTags, trending, wherePopular, recommend, type Entity } from "../qloo";
import type { Artist, Audience, CityScore, Engine, LogLine, Plan, Stop } from "../types";
import { roomCapacity } from "../web";
import { doorAdvice } from "./audience";
import { HEAT_AREAS, scoreCities, type HeatTile } from "./cities";
import { checkNumbers, evidenceLines, room } from "./evidence";
import { writePitches } from "./pitch";
import { planTour } from "./plan";
import { lookUpAfter } from "./tools";

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

export async function* runTour(input: { artist: string; from: string; firstDate: string; shows: number }, useModel: boolean): AsyncGenerator<Event> {
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

    // 2. Where the fans are, and who they are, in parallel.
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 26 * 7 * 86_400_000).toISOString().slice(0, 10);
    const heatP = Promise.all(
      HEAT_AREAS[region].map(async (area) => {
        const t0 = Date.now();
        try {
          const r = await wherePopular(artist.id, area, 50);
          log({ kind: "qloo", text: `Where do ${artist.name} fans over-index in ${area}?`, result: `${r.tiles.length} heatmap tiles`, request: describeRequest(r.request), ms: Date.now() - t0 });
          return r.tiles;
        } catch (e) {
          log({ kind: "qloo", text: `Where do ${artist.name} fans over-index in ${area}?`, result: (e as Error).message, failed: true });
          return [] as HeatTile[];
        }
      }),
    ).then((l) => l.flat());

    const audience: Audience = { age: {}, gender: {}, tags: [], trend: [], brands: [] };
    const audP = Promise.all([
      (async () => {
        const t0 = Date.now();
        try {
          const r = await demographics(artist.id);
          if (r.skew) {
            audience.age = r.skew.age;
            audience.gender = r.skew.gender;
            audience.advice = doorAdvice(audience.age);
          }
          log({ kind: "qloo", text: `Who are ${artist.name}'s fans, by age and gender?`, result: audience.advice ?? "No demographic skew came back.", request: describeRequest(r.request), ms: Date.now() - t0 });
        } catch (e) {
          log({ kind: "qloo", text: `Who are ${artist.name}'s fans?`, result: (e as Error).message, failed: true });
        }
      })(),
      (async () => {
        const t0 = Date.now();
        try {
          const r = await tasteTags([artist.id], { take: 12 });
          audience.tags = r.tags.filter((x) => x.name.toLowerCase() !== artist.name.toLowerCase()).slice(0, 10).map((x) => ({ id: x.id, name: x.name, affinity: x.affinity }));
          log({ kind: "qloo", text: `What else do ${artist.name} fans love?`, result: audience.tags.slice(0, 5).map((x) => x.name).join(", ") || "Nothing came back.", request: describeRequest(r.request), ms: Date.now() - t0 });
        } catch (e) {
          log({ kind: "qloo", text: `What else do ${artist.name} fans love?`, result: (e as Error).message, failed: true });
        }
      })(),
      (async () => {
        const t0 = Date.now();
        try {
          const r = await trending(artist.id, "urn:entity:artist", start, end);
          audience.trend = r.points.map((p) => ({ date: p.date, percentile: p.percentile, velocity: p.velocity }));
          const a = r.points[0]?.percentile, b = r.points.at(-1)?.percentile;
          log({ kind: "qloo", text: `Is ${artist.name}'s audience growing?`, result: a !== undefined && b !== undefined ? `Popularity percentile ${Math.round(a)} → ${Math.round(b)} over ${r.points.length} weeks` : "No trend data came back.", request: describeRequest(r.request), ms: Date.now() - t0 });
        } catch (e) {
          log({ kind: "qloo", text: `Is ${artist.name}'s audience growing?`, result: (e as Error).message, failed: true });
        }
      })(),
      (async () => {
        const t0 = Date.now();
        try {
          const r = await recommend({ type: "urn:entity:brand", signals: [artist.id], take: 6 });
          audience.brands = r.entities.map((e) => ({ id: e.id, name: e.name }));
          log({ kind: "qloo", text: `Which brands do ${artist.name} fans over-index on (for merch and partners)?`, result: audience.brands.slice(0, 4).map((x) => x.name).join(", ") || "Nothing came back.", request: describeRequest(r.request), ms: Date.now() - t0 });
        } catch (e) {
          log({ kind: "qloo", text: `Which brands do ${artist.name} fans over-index on?`, result: (e as Error).message, failed: true });
        }
      })(),
    ]);

    const tiles = await heatP;
    const cities: CityScore[] = scoreCities(tiles, region);
    log({ kind: "rule", text: `Heatmap tiles placed in their cities (a market is a city of 50k+ with its suburbs).`, result: cities.length ? `${cities.length} cities; strongest: ${cities.slice(0, 4).map((c) => c.name).join(", ")}` : "No tile fell inside a touring city." });
    const heat = tiles.map((x) => ({ lat: x.lat, lon: x.lon, affinity: x.affinity, popularity: x.popularity }));
    ch.push({ t: "plan", plan: { heat, cities } });
    if (cities.length < 2) return fail(`Qloo's heatmap didn't show enough ${REGIONS[region].name} cities for ${artist.name} to route a tour. Try a starting city in another region, or a better-known artist.`);
    await audP;
    ch.push({ t: "plan", plan: { audience } });

    // 3. The agent picks cities, rooms and openers.
    const shows = Math.min(input.shows, cities.length);
    const picked = await planTour({ artist, audience, cities, from, shows, useModel, log });
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

    // 5. Capacity from the web and aftershow spots from Qloo, per stop, in parallel.
    t = Date.now();
    await Promise.all(
      stops.map(async (s) => {
        const r = room(s);
        const [cap, after] = await Promise.all([r ? roomCapacity(r.name, s.city).catch(() => null) : null, lookUpAfter(artist, s.marketId, log)]);
        s.after = after;
        if (r && cap) {
          r.capacity = cap;
          log({ kind: "web", text: `How many does ${r.name} hold?`, result: `${cap.value.toLocaleString("en-US")}, per ${new URL(cap.source).hostname.replace(/^www\./, "")}` });
        } else if (r) log({ kind: "web", text: `How many does ${r.name} hold?`, result: "No capacity found on the web; ask the room." });
      }),
    );
    for (const s of stops) if (s.why) s.why = checkNumbers(s.why, evidenceLines(plan, s)).text;
    ch.push({ t: "plan", plan });

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
