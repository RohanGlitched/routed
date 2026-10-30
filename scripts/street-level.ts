// The street-level check: does Qloo's street heatmap point at the rooms artists really play?
// Protocol: data/outside2/PROTOCOL-6.md, committed before this was scored.
//
// Usage (from routed/; no keys are read and no network call is made, so it needs no .env):
//   npx tsx scripts/street-level.ts members   # which real rooms can be placed on a cached heatmap (no score)
//   npx tsx scripts/street-level.ts           # data/outside2/street-level.json
//
// What it asks. Routed's headline unique value is the street layer: inside each city, Qloo's heatmap (geohash-7
// tiles, about 150 m across) says where the artist's fans over-index, and the day sheet books a room near the
// hottest tile. No test so far checked that layer against anything outside Qloo. Here each real room an artist
// played is placed on that artist's cached street heatmap for that city and compared with the city's other
// candidate rooms and with the city centre: is the real room nearer the hottest tile?
//
// Inputs, all committed or cached, nothing fetched:
//   - street heatmaps: the stored tours' stops (.data/tours/<id>.json plan.stops[].local.tiles, kept out of git),
//     the poster wall's 8 tours first, then any other stored tour of the same artists for cities the wall lacks;
//   - real rooms: data/outside2/venues-truth.json (the venue test's cities), the tour articles already cached
//     (.probe/outside2/wiki, .probe/outside2/pc-wiki, .probe/h2h/wiki; read by lib/wikitours.ts showRows) whose
//     infobox artist is the artist, data/real-tours.json notes of the form "City = Venue", and
//     data/flagship-reality.json realCities (Sierra Ferrell, 2026);
//   - where a real room is: a candidate room of the same name in a stored tour stop or the room test's cache
//     (.probe/outside2/rooms4/city), else the cached Wikidata item's coordinates (P625, .probe/outside2/wikidata).
// fetch is replaced by a function that throws, and the script checks at the end that it was never called. 0 Qloo
// requests and 0 model calls. The output carries only derived distances, strengths and counts, never tiles or
// coordinates.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls++;
  throw new Error("street-level is offline: no network call is allowed");
}) as typeof fetch;

const { findMarket, marketId, marketById } = await import("../lib/geo/markets.ts");
const { kmBetween } = await import("../lib/geo/local.ts");
const { avg, lowerMedian, meanCI, shareFarther, signTest, streetSpot, tileReachKm } = await import("../lib/headtohead.ts");
const { infoboxArtist, regionOfCountry, showRows } = await import("../lib/wikitours.ts");
type RegionId = "na" | "uk" | "eu";
type LocalTile = [number, number, number];
type Room = { name: string; lat: number; lon: number };

const OUT = "data/outside2/street-level.json";
const SEED = 20261025;
/** The poster wall as it stands on Oct 30: 6 tours routed Oct 25 and 2 Oct 30 re-runs. */
const WALL = ["8v4ce57nx6", "ipgunjvpgt", "fx3xht5bex", "at2uxhew2q", "3nuqugrj3n", "xf4rbjj9s9", "xzm49sq9qt", "jrp8bq4md8"];

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const noParen = (s: string) => s.replace(/\s*\([^)]*\)\s*/g, " ").trim();
const sameName = (a: string, b: string) => {
  const x = fold(noParen(a)), y = fold(noParen(b));
  if (!x || !y) return false;
  if (x === y) return true;
  // "Brooklyn Paramount" and "Brooklyn Paramount Theater": one name is the other plus whole words, 2 words at least.
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.split(" ").length >= 2 && (l.startsWith(s + " ") || l.endsWith(" " + s));
};

/* ───────────────── heatmaps ───────────────── */

type Stop = { tour: string; artist: string; marketId: string; lat: number; lon: number; tiles: LocalTile[]; rooms: Room[] };
function stops(): { stops: Map<string, Stop>; allRooms: Map<string, Room[]> } {
  const files = readdirSync(".data/tours").filter((f) => /^[a-z0-9]+\.json$/.test(f));
  const tours = files.map((f) => readJson<any>(`.data/tours/${f}`)).filter((t) => t.plan?.stops?.length);
  const wallArtists = new Set(tours.filter((t) => WALL.includes(t.id)).map((t) => t.plan.artist.name as string));
  // Wall tours first, then the newest other tour of the same artist.
  const order = [...tours].sort((a, b) => Number(WALL.includes(b.id)) - Number(WALL.includes(a.id)) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const out = new Map<string, Stop>();
  const allRooms = new Map<string, Room[]>();
  for (const t of order) {
    for (const s of t.plan.stops) {
      const rooms: Room[] = (s.rooms ?? []).filter((r: any) => Number.isFinite(r.lat) && Number.isFinite(r.lon)).map((r: any) => ({ name: r.name, lat: r.lat, lon: r.lon }));
      (allRooms.get(s.marketId) ?? allRooms.set(s.marketId, []).get(s.marketId)!).push(...rooms);
      const artist: string = t.plan.artist.name;
      if (!wallArtists.has(artist) || !s.local?.tiles?.length) continue;
      const key = `${artist}|${s.marketId}`;
      if (!out.has(key)) out.set(key, { tour: t.id, artist, marketId: s.marketId, lat: s.lat, lon: s.lon, tiles: s.local.tiles, rooms });
    }
  }
  const r4 = ".probe/outside2/rooms4/city";
  if (existsSync(r4))
    for (const f of readdirSync(r4))
      for (const c of readJson<any[]>(`${r4}/${f}`) ?? [])
        for (const r of c.rooms ?? []) if (Number.isFinite(r.lat) && Number.isFinite(r.lon)) (allRooms.get(c.marketId) ?? allRooms.set(c.marketId, []).get(c.marketId)!).push({ name: r.name, lat: r.lat, lon: r.lon });
  return { stops: out, allRooms };
}

/* ───────────────── real rooms ───────────────── */

type Real = { artist: string; marketId: string; venue: string; qid?: string; source: string };
function realRooms(artists: Set<string>): Real[] {
  const out: Real[] = [];
  const vt = readJson<{ subjects: { artist: string; tour: string; cities: { marketId: string; venues: { names: string[]; qid?: string }[] }[] }[] }>("data/outside2/venues-truth.json");
  for (const s of vt.subjects) {
    if (!artists.has(s.artist)) continue;
    for (const c of s.cities) for (const v of c.venues) out.push({ artist: s.artist, marketId: c.marketId, venue: v.names[0]!, qid: v.qid, source: `venues-truth.json (${s.tour})` });
  }
  for (const dir of [".probe/outside2/wiki", ".probe/outside2/pc-wiki", ".probe/h2h/wiki"]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const page = readJson<any>(`${dir}/${f}`).query?.pages?.[0];
      const text: string | undefined = page?.revisions?.[0]?.slots?.main?.content;
      const who = text ? infoboxArtist(text) : undefined;
      const artist = who && [...artists].find((a) => fold(a) === fold(who));
      if (!text || !artist) continue;
      for (const r of showRows(text)) {
        const region = regionOfCountry(r.country) as RegionId | undefined;
        if (!region || !r.venue) continue;
        const m = findMarket(r.city, region) ?? findMarket(r.city.split(",")[0]!, region);
        if (m) out.push({ artist, marketId: marketId(m), venue: r.venue, source: `Wikipedia: ${page.title}` });
      }
    }
  }
  for (const t of readJson<{ artist: string; region: RegionId; tour?: string; note?: string }[]>("data/real-tours.json")) {
    if (!artists.has(t.artist) || !t.note) continue;
    for (const m of t.note.matchAll(/(?:^|[.;,]\s*)([A-Z][A-Za-z .'-]+?) = ([^.;,()]+?)(?=\s*[.;,(]|$)/g)) {
      const mk = findMarket(m[1]!.trim(), t.region);
      // "New York = Brooklyn (Barclays)": the room is in the brackets.
      const venue = /^Brooklyn$/i.test(m[2]!.trim()) ? (/\(([^)]+)\)/.exec(t.note.slice(m.index! + m[0].length, m.index! + m[0].length + 30))?.[1] ?? "") : m[2]!.trim();
      if (mk && venue && !/^(The )?[A-Z][a-z]+$/.test(venue)) out.push({ artist: t.artist, marketId: marketId(mk), venue, source: `real-tours.json (${t.tour})` });
    }
  }
  const fr = readJson<{ artist: string; tour: { name: string }; realCities: { city: string; venue: string }[] }>("data/flagship-reality.json");
  if (artists.has(fr.artist))
    for (const c of fr.realCities) {
      const m = findMarket(c.city.replace(/\s*\(.*$/, ""), "na");
      if (m) out.push({ artist: fr.artist, marketId: marketId(m), venue: noParen(c.venue), source: `flagship-reality.json (${fr.tour.name})` });
    }
  // One row per artist, city and room.
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.artist}|${r.marketId}|${fold(noParen(r.venue))}`;
    return !seen.has(k) && !!seen.add(k);
  });
}

/** Venue names to Wikidata coordinates, from the venue test's cached items only (a name on two items is dropped). */
function wikidataCoords() {
  const byName = new Map<string, Set<string>>();
  const at = new Map<string, { lat: number; lon: number }>();
  for (const f of readdirSync(".probe/outside2/wikidata")) {
    for (const [id, e] of Object.entries<any>(readJson<any>(`.probe/outside2/wikidata/${f}`).entities ?? {})) {
      const v = e.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      if (v && Number.isFinite(v.latitude)) at.set(id, { lat: v.latitude, lon: v.longitude });
      for (const n of [e.labels?.en?.value, ...(e.aliases?.en ?? []).map((a: any) => a.value)]) if (n) (byName.get(fold(n)) ?? byName.set(fold(n), new Set()).get(fold(n))!).add(id);
    }
  }
  return (r: Real) => {
    const q = r.qid ?? (() => {
      const h = byName.get(fold(noParen(r.venue)));
      return h && h.size === 1 ? [...h][0] : undefined;
    })();
    return q ? at.get(q) : undefined;
  };
}

/* ───────────────── cases ───────────────── */

type Case = {
  artist: string; city: string; marketId: string; tour: string; venue: string; source: string;
  located: "candidate room" | "Wikidata" | null; inReach: boolean; others: number; why?: string;
  at?: { lat: number; lon: number }; stop: Stop;
};
function cases(): Case[] {
  const { stops: st, allRooms } = stops();
  const artists = new Set([...st.values()].map((s) => s.artist));
  const coords = wikidataCoords();
  const out: Case[] = [];
  for (const r of realRooms(artists)) {
    const s = st.get(`${r.artist}|${r.marketId}`);
    if (!s) continue;
    const city = marketById(r.marketId)?.name ?? r.marketId;
    const room = (allRooms.get(r.marketId) ?? []).find((x) => sameName(x.name, r.venue));
    const wd = room ? undefined : coords(r);
    const at = room ? { lat: room.lat, lon: room.lon } : wd;
    const base = { artist: r.artist, city, marketId: r.marketId, tour: s.tour, venue: r.venue, source: r.source, stop: s };
    if (!at) {
      out.push({ ...base, located: null, inReach: false, others: 0, why: "no candidate room of that name and no cached Wikidata coordinates" });
      continue;
    }
    const centre = { lat: s.lat, lon: s.lon };
    const inReach = kmBetween(centre, at) <= tileReachKm(s.tiles, centre);
    const others = s.rooms.filter((x) => !sameName(x.name, r.venue) && kmBetween(x, at) > 0.2);
    out.push({
      ...base, located: room ? "candidate room" : "Wikidata", inReach, others: others.length, at,
      ...(inReach ? {} : { why: "farther from the city centre than the heatmap's farthest kept tile" }),
      ...(inReach && others.length < 3 ? { why: "fewer than 3 other candidate rooms" } : {}),
    });
  }
  return out;
}

const eligible = (c: Case) => c.located && c.inReach && c.others >= 3;

/* ───────────────── run ───────────────── */

const all = cases();
const mode = process.argv[2];

if (mode === "members") {
  for (const c of all) console.log(`${eligible(c) ? "IN " : "out"}  ${c.artist} | ${c.city} | ${c.venue} | ${c.source} | ${c.located ?? "unlocated"}${c.why ? ` | ${c.why}` : ""}`);
  console.log(`\n${all.filter(eligible).length} eligible of ${all.length} real rooms on a cached heatmap city; fetch calls: ${fetchCalls}`);
  // Sizing the larger run (not run here): every room-test city whose real room can be placed from the caches and
  // that has at least 3 other cached candidate rooms needs 1 Qloo street heatmap request (artist x city).
  const { allRooms } = stops();
  const coords = wikidataCoords();
  const vt = readJson<{ subjects: { artist: string; cities: { marketId: string; venues: { names: string[]; qid?: string }[] }[] }[] }>("data/outside2/venues-truth.json");
  let cities = 0, placeable = 0;
  for (const s of vt.subjects)
    for (const c of s.cities) {
      cities++;
      const rooms = allRooms.get(c.marketId) ?? [];
      const ok = c.venues.some((v) => {
        const at = rooms.find((x) => v.names.some((n) => sameName(x.name, n))) ?? coords({ artist: s.artist, marketId: c.marketId, venue: v.names[0]!, qid: v.qid, source: "" });
        return !!at && rooms.filter((x) => !v.names.some((n) => sameName(x.name, n)) && kmBetween(x, at) > 0.2).length >= 3;
      });
      if (ok) placeable++;
    }
  console.log(`Larger run: ${placeable} of ${cities} room-test cities can place the real room and have 3+ other cached rooms, so about ${placeable} Qloo heatmap requests (1 per artist and city).`);
} else {
  const rows = all.filter(eligible).map((c) => {
    const s = c.stop;
    const real = streetSpot(s.tiles, c.at!)!;
    const centre = streetSpot(s.tiles, { lat: s.lat, lon: s.lon })!;
    const others = s.rooms.filter((x) => !sameName(x.name, c.venue) && kmBetween(x, c.at!) > 0.2).map((x) => streetSpot(s.tiles, x)!);
    const r1 = (x: number) => Math.round(x * 10) / 10;
    return {
      artist: c.artist, city: c.city, venue: c.venue, source: c.source, tour: c.tour, located: c.located,
      realKm: r1(real.km), realStrength: real.strength,
      othersMedianKm: r1(lowerMedian(others.map((o) => o.km))!), othersMedianStrength: lowerMedian(others.map((o) => o.strength))!, others: others.length,
      centreKm: r1(centre.km), centreStrength: centre.strength,
      shareFarther: Math.round(shareFarther(real.km, others.map((o) => o.km))! * 1000) / 1000,
      // unrounded, for the tests below
      _d: { rooms: lowerMedian(others.map((o) => o.km))! - real.km, centre: centre.km - real.km, strength: real.strength - lowerMedian(others.map((o) => o.strength))! },
    };
  });
  const contrast = (name: string, d: number[]) => {
    const st = signTest(d);
    const ci = meanCI(d, SEED);
    return { name, n: d.length, meanDiff: ci.mean, lo: ci.lo, hi: ci.hi, wins: st.wins, losses: st.losses, ties: st.ties, p: st.p };
  };
  const n = rows.length;
  const result = {
    scored: new Date().toISOString().slice(0, 10),
    protocol: "data/outside2/PROTOCOL-6.md",
    script: "scripts/street-level.ts",
    usage: { qloo: 0, modelCalls: 0, fetchCalls },
    n,
    candidates: all.length,
    excluded: all.filter((c) => !eligible(c)).map((c) => ({ artist: c.artist, city: c.city, venue: c.venue, why: c.why })),
    primary: contrast("Real room vs the city's other candidate rooms (median): km to the hottest tile, positive = the real room is nearer", rows.map((r) => r._d.rooms)),
    secondary: [
      contrast("Real room vs the city centre: km to the hottest tile, positive = the real room is nearer", rows.map((r) => r._d.centre)),
      contrast("Real room vs the city's other candidate rooms (median): tile strength within 0.35 km, positive = the real room's tile is hotter", rows.map((r) => r._d.strength)),
    ],
    meanShareFarther: avg(rows.map((r) => r.shareFarther)),
    inHot: rows.filter((r) => r.realKm <= 1.5 || r.realStrength >= 0.9).length,
    tooSmall: n < 10,
    rows: rows.map(({ _d, ...r }) => r),
  };
  if (fetchCalls !== 0) throw new Error(`street-level made ${fetchCalls} fetch calls`);
  writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");
  console.log(JSON.stringify({ n, primary: result.primary, secondary: result.secondary, meanShareFarther: result.meanShareFarther, inHot: result.inHot }, null, 1));
  for (const r of result.rows) console.log(`${r.artist} | ${r.city} | ${r.venue}: real ${r.realKm} km (s ${r.realStrength}), rooms median ${r.othersMedianKm} km (s ${r.othersMedianStrength}, n ${r.others}), centre ${r.centreKm} km, nearer than ${Math.round(r.shareFarther * 100)}% of rooms`);
}
if (fetchCalls !== 0) throw new Error(`street-level made ${fetchCalls} fetch calls`);
