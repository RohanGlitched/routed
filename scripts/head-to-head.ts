// The head-to-head: what Qloo's taste data changes, on a ruler Qloo didn't make.
// Usage (from routed/, keys in .env.local):
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/head-to-head.ts sample   # held-out artists
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/head-to-head.ts run      # Qloo + model calls
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/head-to-head.ts score    # results.json
//
// PROTOCOL (fixed and committed before any of it ran; the commit that adds this file is the record)
//
// Question. The benchmark on /proof scores both tours on Qloo's own heatmap, which is circular, and the outside
// check (eight picks against each artist's real tour) came out a tie. Neither says what Qloo's data changes.
//
// Ground truth: the touring markets each artist actually played on one recent headline tour, in one region.
//   Bench set: the 19 benchmark artists with a real tour in data/real-tours.json (compiled Oct 15, before this test).
//   Held-out set: artists nobody here chose. Every page in Wikipedia's "2024 concert tours" and "2025 concert tours"
//   categories (fetched once, the list saved in data/head-to-head/categories.json), ordered by the SHA-256 of the
//   page title (an order nobody picked), walked in that order. A tour is taken when (1) its infobox names exactly
//   one artist, (2) that artist is not a bench artist and has no earlier tour taken, (3) its date tables
//   (lib/wikitours.ts: tables with a City column; cancelled sections, cancelled or postponed rows and festival rows
//   left out) put at least 8 touring markets in one region (North America, the UK and Ireland, or mainland Europe;
//   the region with the most), and (4) Qloo's search finds the artist by exact name. The first 30 taken are the set.
//   Every skipped page and its reason is saved in data/head-to-head/held-out.json.
//
// Test 1, the rankings (all artists). Four rankings of every touring market in the tour's region:
//   P  population: biggest metro first (GeoNames, the markets Routed routes between).
//   M  the model alone: Nemotron 3 Ultra (the agent's model) asked, with no Qloo, for the 50 cities where the
//      artist would sell the most tickets for a headline show, strongest first; names matched to markets, the
//      unmatched dropped, the rest of the list filled by population.
//   Q  Qloo: the artist's Qloo heatmap ranking, exactly as Routed computes it (lib/agent/cities.ts scoreCities, one
//      polygon per region); markets with no tile follow, by population. Bench artists use the ranking stored with
//      their Oct 15 benchmark tour; held-out artists get one heatmap call each.
//   Q+P Qloo and population, no weight to tune: the average of a market's two places (lib/headtohead.ts).
//   Metric: R-precision. With R markets on the real tour, how many of a ranking's top R did the artist play?
//   Primary contrasts: (a) Q+P vs P: does Qloo's taste data add to the obvious prior? (b) Q vs M: Qloo's ranking
//   against the model's own knowledge. Secondary: Q vs P, M vs P, and "beyond the biggest cities" (of the real
//   tour's markets outside population's top R, how many each ranking's top R found).
//
// Test 2, the ablation (bench artists, same inputs as the benchmark: starting city, crowd, 8 shows). The agent's
//   own shortlist step (lib/agent/plan.ts shortlistPrompt, same model, same schema) and the same city rules
//   (radius clause, fill from the ranking, the leg rule, major markets kept), run in two arms that differ only in
//   the evidence: arm Q gets Qloo's table and Qloo's audience line, exactly as Routed does; arm P gets the region's
//   biggest cities by population and the artist's name. Three runs per arm (two: see the change below). Rooms aren't looked up in either arm
//   (every city counts as having a room), so this isolates the choice of cities. Also, with no model: the fixed
//   plan (strongest cities that clear the rules) on each ranking.
//   Metric: the share of the 8 cities on the artist's real tour (the outside check's measure). Primary contrast:
//   arm Q vs arm P, per artist averaged over the runs.
//
// One change, made Oct 18 after Test 1's model calls had started and before any ablation call ran: the owner cut
// the model budget for this work to $1, so the ablation runs two times per arm, not three, and the run stops before
// any call that would take the estimated spend (Token Factory list price for Nemotron 3 Ultra, $1 in and $3 out
// per million tokens) past $0.95. Nothing had been scored when this changed.
//
// A second change, made after Test 1 was first scored and in the model's favour: the model often names cities the
// market list folds into a bigger neighbour (Wolverhampton is Birmingham, Bochum is the Ruhr's market), and matching
// by name alone dropped them, filling its list with population instead. Names that don't match are now placed by
// their Wikipedia coordinates (nearest touring market within 60 km), as the real tours' towns are. Qloo's side is
// unchanged. The first scoring is kept in data/head-to-head/results-name-match-only.json.
//
// Added after the results, and reported whatever it showed (so weaker evidence than the tests above): the model's
// ranking and Qloo's averaged the same way, against the model alone. Test 1 says Qloo adds to population; this asks
// whether it adds to the model.
//
// Statistics, for every contrast: per-artist differences, wins / losses / ties, an exact two-sided sign test,
// and the mean difference with a 95% bootstrap interval (10,000 resamples, seed 20261018). Results are published
// whichever way they come out, every artist listed. Nothing is re-run to change an answer; a run that fails is
// retried once and otherwise reported as missing.
//
// Limits stated up front: a past tour is one booker's answer, made with ticket data neither side has; the model
// may have read these tours' announcements (it favours M); Qloo's signals may include check-ins at these very
// shows (it favours Q); Wikipedia tour articles lean towards big acts, where population is hard to beat.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { brief, POOL_SIZE, role, shortlistPrompt, SHORTLIST_SCHEMA, table } from "../lib/agent/plan.ts";
import { pickArtist } from "../lib/agent/rooms.ts";
import { HEAT_AREAS, scoreCities } from "../lib/agent/cities.ts";
import { CA_ABBR, findMarket, km, marketById, marketId, marketLabel, nearestMarket, REGIONS, US_STATES, type RegionId } from "../lib/geo/markets.ts";
import { keepAnchors, radiusFor, repairLegs, tooClose } from "../lib/geo/route.ts";
import { beyondBiggest, blendRanking, blendTwo, completeRanking, meanCI, populationRanking, precision, rPrecision, signTest, avg, type Hit } from "../lib/headtohead.ts";
import { MODELS, structured } from "../lib/nebius.ts";
import { realMarkets, realTourFor } from "../lib/outside.ts";
import { search, wherePopular } from "../lib/qloo.ts";
import { newUsage, withUsage } from "../lib/usage.ts";
import { infoboxArtist, marketsByRegion, showRows, regionOfCountry } from "../lib/wikitours.ts";
import type { CityScore, TourRecord } from "../lib/types.ts";

const DATA = "data/head-to-head";
/** Score with the first, name-only matching of the model's cities (kept for the record). */
const NAME_ONLY = process.argv.includes("--name-only");
const CACHE = ".probe/h2h";
const HELD_OUT_SIZE = 30;
const MIN_MARKETS = 8;
const RUNS = 2;
/** Token Factory list price for Nemotron 3 Ultra, dollars per token, and the cap for this work. */
const PRICE = { in: 1e-6, out: 3e-6 };
const CAP_USD = 0.95;
const SHOWS = 8;
const LIVE = "https://routed-tours.vercel.app";
const UA = "RoutedHeadToHead/1.0 (https://github.com/RohanGlitched/routed)";

/** The 20 benchmark tours of Oct 15 (README); Jamie xx has no real tour on file, so 19 are scored. */
export const BENCH: Record<string, string> = {
  "Zach Bryan": "ycw8uxaih4", "Tyler Childers": "h9unk4ctck", Caamp: "bbtnq56vfv", Waxahatchee: "9tjig3f979", Khruangbin: "43wf8pvmzv",
  "Durand Jones & The Indications": "n25xq8c6j9", Ghost: "vfzwt8vpab", "Knocked Loose": "fzpz68yjqg", Turnstile: "h2puujjejv", Cuco: "79kyqre6nk",
  "MJ Lenderman": "2qhu4qsskk", Parcels: "d2ki8vdty2", "Jamie xx": "thvmp9vhbc", Alvvays: "nipn2k4cnd", "Arlo Parks": "gyr7wp8vpn", "Wet Leg": "cdnahzimdu",
  "Japanese Breakfast": "bgyrxqguyf", "Fontaines D.C.": "avqijwpkgy", JPEGMAFIA: "ecm4c8q9xe", Clairo: "kvda9edhz9",
};

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const slug = (s: string) => fold(s).replace(/ /g, "-");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const writeJson = (p: string, v: unknown) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 1) + "\n");
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function wiki(params: Record<string, string>): Promise<any> {
  const u = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(u, { headers: { "user-agent": UA } });
    if (r.ok) return r.json();
    await sleep(1000 * (i + 1));
  }
  throw new Error(`Wikipedia ${r400(u)}`);
}
const r400 = (u: string) => u.slice(0, 120);

/* ───────────────────────── sample: the held-out artists ───────────────────────── */

// qlooId and qlooName are written by `sample` and stripped before commit (scripts/strip-qloo-data.mjs, M8); a
// later stage finds the artist again by name the same way (pickArtist on Qloo's search).
type HeldOut = { artist: string; qlooId?: string; qlooName?: string; title: string; revid: number; region: RegionId; markets: string[]; source: string };

async function sample() {
  const catPath = `${DATA}/categories.json`;
  if (!existsSync(catPath)) {
    const titles = new Set<string>();
    for (const y of ["2024", "2025"]) {
      let cont: string | undefined;
      do {
        const j = await wiki({ action: "query", list: "categorymembers", cmtitle: `Category:${y} concert tours`, cmlimit: "500", cmtype: "page", ...(cont ? { cmcontinue: cont } : {}) });
        for (const m of j.query.categorymembers) titles.add(m.title);
        cont = j.continue?.cmcontinue;
      } while (cont);
    }
    writeJson(catPath, { fetched: new Date().toISOString(), categories: ["Category:2024 concert tours", "Category:2025 concert tours"], titles: [...titles].sort() });
  }
  const { titles } = readJson<{ titles: string[] }>(catPath);
  const order = [...titles].sort((a, b) => (sha(a) < sha(b) ? -1 : 1));
  const bench = new Set(Object.keys(BENCH).map(fold));
  const taken: HeldOut[] = [];
  const skipped: { title: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const title of order) {
    if (taken.length >= HELD_OUT_SIZE) break;
    const page = await cached(`${CACHE}/wiki/${sha(title).slice(0, 16)}.json`, () => wiki({ action: "query", prop: "revisions", rvprop: "ids|content", rvslots: "main", titles: title }));
    const rev = page.query.pages[0]?.revisions?.[0];
    const text: string = rev?.slots?.main?.content ?? "";
    const artist = infoboxArtist(text);
    if (!artist) {
      skipped.push({ title, reason: "the infobox doesn't name exactly one artist" });
      continue;
    }
    if (bench.has(fold(artist))) {
      skipped.push({ title, reason: `${artist} is a benchmark artist` });
      continue;
    }
    if (seen.has(fold(artist))) {
      skipped.push({ title, reason: `${artist} already has a tour in the set` });
      continue;
    }
    const rows = showRows(text);
    // Towns that aren't touring markets by name are placed by their Wikipedia coordinates (nearest market within 60 km).
    const unplaced = [...new Set(rows.filter((r) => regionOfCountry(r.country) && !findMarket(r.city, regionOfCountry(r.country)) && !findMarket(r.city.split(",")[0]!, regionOfCountry(r.country))).map((r) => r.city))];
    const at = await coordinates(unplaced);
    const by = marketsByRegion(rows, at);
    const region = (["na", "uk", "eu"] as RegionId[]).sort((a, b) => by[b].length - by[a].length)[0]!;
    if (by[region].length < MIN_MARKETS) {
      skipped.push({ title, reason: `${artist}: ${by[region].length} touring markets in one region (fewer than ${MIN_MARKETS}; ${rows.length} show rows read)` });
      continue;
    }
    const found = await search(artist, "urn:entity:artist", 5);
    const exact = found.entities.find((e) => fold(e.name) === fold(artist));
    const { pick } = pickArtist(artist, found.entities);
    if (!exact || !pick || fold(pick.name) !== fold(artist)) {
      skipped.push({ title, reason: `${artist}: no exact artist match on Qloo` });
      continue;
    }
    seen.add(fold(artist));
    taken.push({ artist, qlooId: pick.id, qlooName: pick.name, title, revid: rev.revid, region, markets: by[region], source: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, "_"))}&oldid=${rev.revid}` });
    console.log(`taken ${taken.length}: ${artist} (${title}) ${REGIONS[region].name}, ${by[region].length} markets`);
  }
  writeJson(`${DATA}/held-out.json`, { rule: "scripts/head-to-head.ts PROTOCOL, held-out set", size: HELD_OUT_SIZE, taken, skipped });
  console.log(`held-out: ${taken.length} taken, ${skipped.length} skipped`);
}

async function coordinates(names: string[]): Promise<Record<string, [number, number]>> {
  const out: Record<string, [number, number]> = {};
  for (let i = 0; i < names.length; i += 40) {
    const batch = names.slice(i, i + 40);
    const j = await cached(`${CACHE}/coords/${sha(batch.join("|")).slice(0, 16)}.json`, () => wiki({ action: "query", prop: "coordinates", redirects: "1", titles: batch.join("|") }));
    const back = new Map<string, string>();
    for (const n of batch) back.set(n, n);
    for (const x of j.query?.normalized ?? []) back.set(x.to, back.get(x.from) ?? x.from);
    for (const x of j.query?.redirects ?? []) back.set(x.to, back.get(x.from) ?? x.from);
    for (const p of j.query?.pages ?? []) {
      const c = p.coordinates?.[0];
      if (!c) continue;
      let name = p.title;
      while (back.has(name) && back.get(name) !== name) name = back.get(name)!;
      out[name] = [c.lat, c.lon];
    }
  }
  return out;
}

async function cached<T>(path: string, fn: () => Promise<T>): Promise<T> {
  if (existsSync(path)) return readJson<T>(path);
  const v = await fn();
  writeJson(path, v);
  return v;
}

/* ───────────────────────── run: Qloo and the model ───────────────────────── */

type Subject = { artist: string; set: "bench" | "held-out"; region: RegionId; truth: string[]; tour: string; source: string; qlooId?: string; benchId?: string };

function subjects(): Subject[] {
  const out: Subject[] = [];
  for (const [artist, id] of Object.entries(BENCH)) {
    const real = realTourFor(artist);
    if (!real) continue;
    out.push({ artist, set: "bench", region: real.region, truth: [...realMarkets(real)], tour: `${real.tour}${real.year ? `, ${real.year}` : ""}`, source: real.sources[0] ?? "", benchId: id });
  }
  const held = readJson<{ taken: HeldOut[] }>(`${DATA}/held-out.json`).taken;
  for (const h of held) out.push({ artist: h.artist, set: "held-out", region: h.region, truth: h.markets, tour: h.title, source: h.source, qlooId: h.qlooId });
  return out;
}

const benchTour = (id: string) =>
  cached<TourRecord>(`${CACHE}/bench/${id}.json`, async () => {
    for (let i = 0; ; i++) {
      try {
        return (await (await fetch(`${LIVE}/api/tours/${id}`)).json()) as TourRecord;
      } catch (e) {
        if (i >= 3) throw e;
        await sleep(2000 * (i + 1));
      }
    }
  });

async function qlooRanking(s: Subject): Promise<{ ids: string[]; cities: CityScore[] }> {
  return cached(`${CACHE}/qloo/${slug(s.artist)}.json`, async () => {
    if (s.benchId) {
      const t = await benchTour(s.benchId);
      if (t.plan!.region !== s.region) throw new Error(`${s.artist}: bench tour region ${t.plan!.region} vs real tour ${s.region}`);
      return { ids: t.plan!.cities.map((c) => c.marketId), cities: t.plan!.cities };
    }
    const id = s.qlooId ?? pickArtist(s.artist, (await search(s.artist, "urn:entity:artist", 5)).entities).pick?.id;
    if (!id) throw new Error(`${s.artist}: not found on Qloo`);
    const { tiles } = await wherePopular(id, HEAT_AREAS[s.region][0]!.within, 50);
    const cities = scoreCities(tiles, s.region);
    return { ids: cities.map((c) => c.marketId), cities };
  });
}

const RANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { cities: { type: "array", items: { type: "object", additionalProperties: false, properties: { city: { type: "string" }, area: { type: "string" } }, required: ["city", "area"] } } },
  required: ["cities"],
};
const regionName = (r: RegionId) => (r === "eu" ? "mainland Europe (not the UK or Ireland)" : REGIONS[r].name);
export const rankPrompt = `You are an experienced booking agent. Using only your own knowledge of the artist and the cities, rank the cities in the region given where this artist would sell the most tickets for a headline show, strongest first.
Rules: exactly 50 cities, one entry per city (suburbs count as the city they belong to), each with its state, province or country, all in the region given.
Reply as JSON only.`;

async function modelRanking(s: Subject): Promise<{ named: { city: string; area: string }[]; ids: (string | null)[]; model: string }> {
  return cached(`${CACHE}/model/${slug(s.artist)}.json`, async () => {
    const { data, model } = await structured<{ cities: { city: string; area: string }[] }>(MODELS.agent, {
      name: "ranking",
      schema: RANK_SCHEMA,
      maxTokens: 3000,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: rankPrompt },
        { role: "user", content: `Artist: ${s.artist}.\nRegion: ${regionName(s.region)}.` },
      ],
    });
    const named = (data.cities ?? []).slice(0, 50);
    const ids = named.map((c) => {
      const m = findMarket(`${c.city}, ${c.area}`, s.region) ?? findMarket(c.city, s.region);
      return m ? marketIdOf(m) : null;
    });
    return { named, ids, model };
  });
}
/**
 * The model's cities placed on touring markets: by name, else by the Wikipedia coordinates of "City, State" (North
 * America) or "City" and then "City, Area" (the UK and Europe), nearest market within 60 km. A town with no market
 * near it, or a name Wikipedia can't place in the region, is dropped.
 */
async function placeModelCities(named: { city: string; area: string }[], region: RegionId): Promise<(string | null)[]> {
  const byName = named.map((c) => findMarket(`${c.city}, ${c.area}`, region) ?? findMarket(c.city, region));
  const titles = (c: { city: string; area: string }) => {
    const a = c.area.trim();
    const full = US_STATES[a.toUpperCase()] ? US_STATES[a.toUpperCase()]!.replace(/(^|\s)\w/g, (x) => x.toUpperCase()) : Object.entries(CA_ABBR).find(([, v]) => v === a.toUpperCase())?.[0] ?? a;
    return region === "na" ? [`${c.city}, ${full}`, c.city] : [c.city, `${c.city}, ${a}`];
  };
  const want = [...new Set(named.filter((_, i) => !byName[i]).flatMap(titles))];
  const at = await coordinates(want);
  return named.map((c, i) => {
    if (byName[i]) return marketId(byName[i]!);
    for (const t of titles(c)) {
      const p = at[t];
      const m = p ? nearestMarket({ lat: p[0], lon: p[1] }, region, 60) : null;
      if (m) return marketId(m);
    }
    return null;
  });
}

const marketIdOf = (m: { ascii: string; cc: string; state: string }) => [m.ascii, m.cc, m.cc === "US" ? m.state : ""].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-");

/* The ablation's two arms. */

type City = CityScore & { pop: number };

function popCities(region: RegionId): City[] {
  return populationRanking(region).map((id, i) => {
    const m = marketById(id)!;
    return { marketId: id, name: m.name, label: marketLabel(m), lat: m.lat, lon: m.lon, affinity: 0, tiles: 0, rank: i + 1, pop: m.pop };
  });
}

function popTable(cities: City[], from: { lat: number; lon: number }, radius: number): string {
  const rows = cities.map((c) => `${c.marketId} | ${c.label} | #${c.rank} by population | ${c.pop.toLocaleString("en-US")} people | ${Math.round(km(from, c))} km from start`);
  const close: string[] = [];
  for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) if (tooClose(cities[i]!, cities[j]!, radius)) close.push(`${cities[i]!.marketId} ~ ${cities[j]!.marketId}`);
  return `city_id | city | size rank | metro population | distance\n${rows.join("\n")}${close.length ? `\n\nToo close to pair (radius clause, ${radius} km): ${close.join("; ")}` : ""}`;
}

/** The city rules of lib/agent/plan.ts after the shortlist (guard, fill, leg rule, major markets), every city usable. */
export async function cityRules(shortlist: string[], ranking: City[], from: { lat: number; lon: number }, region: RegionId, shows = SHOWS): Promise<string[]> {
  const radius = radiusFor(region);
  const candidates = ranking.slice(0, Math.max(shows * 2 + 4, 16));
  const byId = new Map(candidates.map((c) => [c.marketId, c]));
  const allById = new Map(ranking.map((c) => [c.marketId, c]));
  const clash = (a: City, b: City) => tooClose(a, b, radius);
  let chosen: City[] = [];
  for (const id of shortlist) {
    const c = byId.get(id);
    if (!c || chosen.some((x) => x.marketId === c.marketId || clash(x, c))) continue;
    chosen.push(c);
    if (chosen.length >= shows) break;
  }
  const deep = ranking.slice(0, Math.max(candidates.length, POOL_SIZE));
  for (const c of deep) {
    if (chosen.length >= shows) break;
    if (chosen.some((x) => x.marketId === c.marketId || clash(x, c))) continue;
    chosen.push(c);
  }
  const asStop = (c: City) => ({ ...c, id: c.marketId });
  const yes = async () => true;
  const pool = ranking.slice(0, POOL_SIZE).map(asStop);
  const legPass = async () => {
    const legs = await repairLegs({ from, stops: chosen.map(asStop), pool, usable: yes, weight: (c) => 1 / Math.sqrt(c.rank), radius });
    for (const sw of legs.swaps) {
      const i = chosen.findIndex((c) => c.marketId === sw.out.id);
      if (i >= 0) chosen.splice(i, 1, allById.get(sw.in.id)!);
    }
  };
  await legPass();
  const anchored = await keepAnchors(chosen.map(asStop), deep.map(asStop), shows, yes, radius);
  if (anchored.added.length) {
    chosen = anchored.stops.map((s) => allById.get(s.id)!);
    await legPass();
  }
  return chosen.map((c) => c.marketId);
}

async function ablationArm(s: Subject, arm: "qloo" | "pop", run: number): Promise<{ shortlist: string[]; cities: string[]; model: string } | null> {
  const path = `${CACHE}/ablation/${slug(s.artist)}-${arm}-${run}.json`;
  if (existsSync(path)) return readJson(path);
  const t = await benchTour(s.benchId!);
  const p = t.plan!;
  const radius = radiusFor(p.region);
  const qloo: City[] = p.cities.map((c) => ({ ...c, pop: marketById(c.marketId)?.pop ?? 0 }));
  const ranking = arm === "qloo" ? qloo : popCities(p.region);
  const candidates = ranking.slice(0, Math.max(SHOWS * 2 + 4, 16));
  const name = p.artist.name;
  const messages =
    arm === "qloo"
      ? [
          { role: "system" as const, content: role(name) },
          { role: "user" as const, content: shortlistPrompt({ brief: brief(p.artist, p.audience!), from: p.from, shows: SHOWS, draw: t.input.draw, source: `Candidate cities from Qloo's heatmap for ${name}, strongest first`, table: table(candidates, p.from, radius), prefer: "preferring stronger cities" }) },
        ]
      : [
          { role: "system" as const, content: `You are a booking agent routing a tour for ${name}. Your evidence is a list of the region's biggest cities by metro population. Use your own knowledge of ${name}, and only numbers from the evidence.` },
          { role: "user" as const, content: shortlistPrompt({ brief: `Artist: ${name}.`, from: p.from, shows: SHOWS, draw: t.input.draw, source: "Candidate cities, biggest metro population first", table: popTable(candidates, p.from, radius), prefer: `preferring the cities where ${name} would draw best` }) },
        ];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const short = await structured<{ cities: { city_id: string; why: string }[]; alternates: string[] }>(MODELS.agent, { name: "shortlist", schema: SHORTLIST_SCHEMA, maxTokens: 6000, timeoutMs: 90_000, messages });
      const shortlist = [...new Set(short.data.cities.map((c) => c.city_id))];
      const cities = await cityRules(shortlist, ranking, p.from, p.region);
      const out = { shortlist, cities, model: short.model };
      writeJson(path, out);
      return out;
    } catch (e) {
      console.error(`  ${s.artist} ${arm} ${run} failed: ${(e as Error).message}`);
    }
  }
  return null;
}

async function run() {
  const usage = newUsage();
  // The first attempt (Oct 18) stopped on a dropped connection after 10 model calls and 9,022 tokens; counted here.
  if (!existsSync(`${CACHE}/usage.json`)) writeJson(`${CACHE}/usage.json`, { ...newUsage(), modelCalls: 10, tokensIn: 0, tokensOut: 9022 });
  const prev = readJson<typeof usage>(`${CACHE}/usage.json`);
  const save = () => writeJson(`${CACHE}/usage.json`, { qloo: prev.qloo + usage.qloo, qlooCached: prev.qlooCached + usage.qlooCached, modelCalls: prev.modelCalls + usage.modelCalls, tokensIn: prev.tokensIn + usage.tokensIn, tokensOut: prev.tokensOut + usage.tokensOut });
  const timer = setInterval(save, 15_000);
  try {
  await withUsage(usage, async () => {
    const all = subjects();
    for (const s of all) {
      const q = await qlooRanking(s);
      const m = await modelRanking(s).catch((e) => (console.error(`  ${s.artist} model ranking failed: ${(e as Error).message}`), null));
      console.log(`${s.artist.padEnd(32)} ${s.set.padEnd(8)} ${s.region} R=${s.truth.length} qloo ${q.ids.length} model ${m ? m.ids.filter(Boolean).length : "-"} | qloo calls ${usage.qloo}, model calls ${usage.modelCalls}, tokens ${usage.tokensIn + usage.tokensOut}`);
    }
    const spent = () => (prev.tokensIn + usage.tokensIn) * PRICE.in + (prev.tokensOut + usage.tokensOut) * PRICE.out;
    for (const s of all.filter((x) => x.set === "bench")) {
      for (let r = 1; r <= RUNS; r++)
        for (const arm of ["qloo", "pop"] as const) {
          // About 3,000 tokens in and 800 out per shortlist call: stop before one that would cross the cap.
          if (spent() + 3500 * PRICE.in + 1200 * PRICE.out > CAP_USD) {
            console.log(`budget: stopping before ${s.artist} ${arm} ${r}, $${spent().toFixed(3)} spent`);
            return;
          }
          await ablationArm(s, arm, r);
        }
      console.log(`ablation ${s.artist} done | model calls ${usage.modelCalls}, tokens ${usage.tokensIn + usage.tokensOut}, about $${spent().toFixed(3)} so far`);
    }
  });
  } finally {
    clearInterval(timer);
    save();
  }
  console.log("this run", usage, "all runs", readJson(`${CACHE}/usage.json`));
}

/* ───────────────────────── score ───────────────────────── */

const label = (id: string) => {
  const m = marketById(id);
  return m ? m.name : id;
};
const share = (h: { hits: number; of: number }) => (h.of ? h.hits / h.of : 0);

function contrast(name: string, a: number[], b: number[]) {
  const d = a.map((x, i) => x - b[i]!);
  const st = signTest(d);
  const ci = meanCI(d);
  return { name, n: d.length, meanA: avg(a), meanB: avg(b), diff: ci.mean, lo: ci.lo, hi: ci.hi, wins: st.wins, losses: st.losses, ties: st.ties, p: st.p };
}

async function score() {
  const all = subjects();
  const rows = [];
  for (const s of all) {
    const truth = new Set(s.truth);
    const q = await qlooRanking(s);
    const m0 = existsSync(`${CACHE}/model/${slug(s.artist)}.json`) ? await modelRanking(s) : null;
    const m = m0 ? { ...m0, ids: NAME_ONLY ? m0.ids : await placeModelCities(m0.named, s.region) } : null;
    const P = populationRanking(s.region);
    const Q = completeRanking(q.ids, s.region);
    const M = m ? completeRanking(m.ids, s.region) : null;
    const B = blendRanking(q.ids, s.region);
    const pack = (h: Hit) => ({ hits: h.hits, of: h.of, cities: h.ids.map(label) });
    rows.push({
      artist: s.artist,
      set: s.set,
      region: s.region,
      tour: s.tour,
      source: s.source,
      R: truth.size,
      modelUnplaced: m ? m.ids.filter((x) => !x).length : null,
      rp: { population: pack(rPrecision(P, truth)), model: M ? pack(rPrecision(M, truth)) : null, qloo: pack(rPrecision(Q, truth)), blend: pack(rPrecision(B, truth)), modelQloo: M ? pack(rPrecision(blendTwo(M, q.ids, s.region), truth)) : null },
      beyond: { model: M ? pack(beyondBiggest(M, truth, s.region)) : null, qloo: pack(beyondBiggest(Q, truth, s.region)), blend: pack(beyondBiggest(B, truth, s.region)) },
    });
  }
  const ok = rows.filter((r) => r.rp.model);
  const v = (k: "population" | "model" | "qloo" | "blend" | "modelQloo", xs = ok) => xs.map((r) => share(r.rp[k]!));
  const sets = { all: ok, bench: ok.filter((r) => r.set === "bench"), heldOut: ok.filter((r) => r.set === "held-out") };
  const test1 = Object.fromEntries(
    Object.entries(sets).map(([k, xs]) => [
      k,
      {
        n: xs.length,
        primary: [contrast("Qloo + population vs population", v("blend", xs), v("population", xs)), contrast("Qloo vs the model alone", v("qloo", xs), v("model", xs))],
        secondary: [
          contrast("Qloo vs population", v("qloo", xs), v("population", xs)),
          contrast("The model alone vs population", v("model", xs), v("population", xs)),
          contrast("Qloo + population vs the model alone", v("blend", xs), v("model", xs)),
        ],
        exploratory: [contrast("The model + Qloo vs the model alone", v("modelQloo", xs), v("model", xs))],
        pooled: Object.fromEntries((["population", "model", "qloo", "blend", "modelQloo"] as const).map((key) => [key, pool(xs.map((r) => r.rp[key]!))])),
        beyond: Object.fromEntries((["model", "qloo", "blend"] as const).map((key) => [key, pool(xs.map((r) => r.beyond[key]!))])),
      },
    ]),
  );

  // Test 2.
  const abl = [];
  for (const s of all.filter((x) => x.set === "bench")) {
    const truth = new Set(s.truth);
    const t = await benchTour(s.benchId!);
    const p = t.plan!;
    const runs = (arm: "qloo" | "pop") =>
      Array.from({ length: RUNS }, (_, i) => `${CACHE}/ablation/${slug(s.artist)}-${arm}-${i + 1}.json`)
        .filter(existsSync)
        .map((f) => precision(readJson<{ cities: string[] }>(f).cities, truth));
    const qloo: City[] = p.cities.map((c) => ({ ...c, pop: marketById(c.marketId)?.pop ?? 0 }));
    const fixedQ = precision(await cityRules([], qloo, p.from, p.region), truth);
    const fixedP = precision(await cityRules([], popCities(p.region), p.from, p.region), truth);
    const routed = precision(p.stops.map((x) => x.marketId), truth);
    const alone = precision(p.guess!.stops.map((x) => x.marketId), truth);
    const rq = runs("qloo"), rp = runs("pop");
    abl.push({
      artist: s.artist,
      qloo: rq.map((h) => h.hits),
      pop: rp.map((h) => h.hits),
      qlooShare: avg(rq.map(share)),
      popShare: avg(rp.map(share)),
      fixedQloo: fixedQ.hits,
      fixedPop: fixedP.hits,
      routed: { hits: routed.hits, of: routed.of },
      alone: { hits: alone.hits, of: alone.of },
    });
  }
  const full = abl.filter((a) => a.qloo.length === RUNS && a.pop.length === RUNS);
  const test2 = {
    n: full.length,
    runs: RUNS,
    primary: contrast("Agent with Qloo vs agent with population", full.map((a) => a.qlooShare), full.map((a) => a.popShare)),
    secondary: [
      contrast("Fixed plan on Qloo vs fixed plan on population", full.map((a) => a.fixedQloo / SHOWS), full.map((a) => a.fixedPop / SHOWS)),
      contrast("Stored Routed tour vs stored model-alone tour (the Oct 15 outside check)", full.map((a) => share(a.routed)), full.map((a) => share(a.alone))),
    ],
  };
  // The model's answers are published (Qloo's responses are not: they stay in the gitignored cache).
  const runs = all.map((s) => ({
    artist: s.artist,
    ranking: existsSync(`${CACHE}/model/${slug(s.artist)}.json`) ? readJson<{ named: unknown[] }>(`${CACHE}/model/${slug(s.artist)}.json`).named : null,
    ablation:
      s.set === "bench"
        ? Object.fromEntries((["qloo", "pop"] as const).map((arm) => [arm, Array.from({ length: RUNS }, (_, i) => `${CACHE}/ablation/${slug(s.artist)}-${arm}-${i + 1}.json`).filter(existsSync).map((f) => readJson<{ shortlist: string[]; cities: string[] }>(f))]))
        : undefined,
  }));
  if (!NAME_ONLY) writeJson(`${DATA}/model-runs.json`, { prompt: rankPrompt, runs });
  // The sample stage's Qloo searches (one per page that reached the exact-name check) ran outside the usage tally.
  const ho = readJson<{ taken: unknown[]; skipped: { reason: string }[] }>(`${DATA}/held-out.json`);
  const searches = ho.taken.length + ho.skipped.filter((x) => /on Qloo/.test(x.reason)).length;
  const u = existsSync(`${CACHE}/usage.json`) ? readJson<ReturnType<typeof newUsage>>(`${CACHE}/usage.json`) : null;
  const usage = u ? { ...u, qlooSearches: searches, dollars: Math.round((u.tokensIn * PRICE.in + u.tokensOut * PRICE.out) * 1000) / 1000 } : null;
  writeJson(`${DATA}/${NAME_ONLY ? "results-name-match-only" : "results"}.json`, { scored: new Date().toISOString(), protocol: "scripts/head-to-head.ts", model: "nvidia/Nemotron-3-Ultra-550b-a55b", usage, test1, test1Rows: rows, test2, test2Rows: abl });
  for (const [k, t] of Object.entries(test1)) {
    console.log(`\nTest 1, ${k} (n=${(t as any).n})`, JSON.stringify((t as any).pooled));
    for (const c of [...(t as any).primary, ...(t as any).secondary, ...(t as any).exploratory]) console.log(fmt(c));
  }
  console.log(`\nTest 2 (n=${test2.n})`);
  for (const c of [test2.primary, ...test2.secondary]) console.log(fmt(c));
}

const pool = (xs: Hit[] | { hits: number; of: number }[]) => {
  const hits = xs.reduce((n, x) => n + x.hits, 0), of = xs.reduce((n, x) => n + x.of, 0);
  return { hits, of, share: of ? hits / of : 0 };
};
const fmt = (c: ReturnType<typeof contrast>) =>
  `${c.name.padEnd(64)} ${(100 * c.meanA).toFixed(1)}% vs ${(100 * c.meanB).toFixed(1)}%  diff ${(100 * c.diff).toFixed(1)} pts [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]  ${c.wins}-${c.losses}-${c.ties}  p=${c.p.toFixed(3)}`;

const stage = process.argv[2];
if (stage === "sample") await sample();
else if (stage === "run") await run();
else if (stage === "score") await score();
else if (stage) console.log("stages: sample | run | score");
