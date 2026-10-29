// Club and theatre acts only: the city rankings on the tours of artists whose real rooms held 3,000 or fewer.
// Protocol: data/outside2/PROTOCOL-5.md, committed before this was scored.
//
// Usage (from routed/; no keys are read and no network call is made, so it needs no .env):
//   npx tsx scripts/indie-subset.ts members   # who is in the subset and why (sizes only, no method's score)
//   npx tsx scripts/indie-subset.ts           # data/outside2/indie-subset.json
//
// What it asks. The published city tests (the head-to-head's 49 older tours, outside2's 13 post-cutoff tours) are
// mostly arena acts. Routed is pitched at acts in rooms of 500 to 3,000. This keeps only the tours whose real rooms
// were that size (lib/headtohead.ts medianCapacity and isClubAndTheatre), then compares the same rankings the same way.
//
// Inputs, all committed or cached, nothing fetched:
//   - each tour's per-ranking hits, as published: data/head-to-head/results.json test1Rows and
//     data/outside2/results.json postcut.rows (scripts/model-plus-qloo.ts already checked both against the caches,
//     49 of 49 and 13 of 13);
//   - room sizes: data/outside2/venues-truth.json (`draw`, the median Wikidata capacity of the real tour's linked
//     venues) for the older tours that have a Wikipedia article; for the 13 post-cutoff tours, the same median over
//     their article's venues, from the article text cached when the tours were sampled (.probe/outside2/pc-wiki) and
//     the Wikidata items cached by the venue test (.probe/outside2/pageprops, .probe/outside2/wikidata); a venue not
//     in that cache stays unmeasured, never looked up; and, for the benchmark tours that have no Wikipedia article,
//     the usual crowd fixed for each artist in scripts/bench.mjs on Oct 8, before any of these tests.
// fetch is replaced by a function that throws, and the script checks at the end that it was never called. The
// output carries only derived sizes, ranks and hit counts.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls++;
  throw new Error("indie-subset is offline: no network call is allowed");
}) as typeof fetch;

const { findMarket, marketId } = await import("../lib/geo/markets.ts");
const { CLUB_THEATRE_MAX, isClubAndTheatre, meanCI, medianCapacity, signTest, avg } = await import("../lib/headtohead.ts");
const { regionOfCountry, showRows } = await import("../lib/wikitours.ts");
type RegionId = "na" | "uk" | "eu";

const OUT = "data/outside2/indie-subset.json";
/** The bootstrap seeds the published tests used (scripts/model-plus-qloo.ts): older tours 20261018, the rest 20261025. */
const SEED = { older: 20261018, postcut: 20261025, pooled: 20261025 } as const;
/** A tour needs this many venues measured for a size (scripts/outside2.ts MIN_MEASURED, the venue test's rule). */
const MIN_MEASURED = 2;

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const noParen = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();

/* ───────────────── room sizes ───────────────── */

/** The usual crowd scripts/bench.mjs fixes per benchmark artist (read as text: importing it would start the benchmark). */
function benchCrowds(): Map<string, number> {
  const src = readFileSync("scripts/bench.mjs", "utf8");
  return new Map([...src.matchAll(/\{\s*artist:\s*"([^"]+)",\s*from:\s*"[^"]*",\s*draw:\s*(\d+)\s*\}/g)].map((m) => [m[1]!, Number(m[2])]));
}

/**
 * Venue names to Wikidata ids and capacities, from the venue test's caches only: every cached article title (and the
 * names that redirect to it) and every cached item's English label and aliases. A name that points at two items is
 * dropped, so a "Paramount Theatre" never borrows another city's room.
 */
function cachedVenueIndex() {
  const byName = new Map<string, Set<string>>();
  const add = (name: string, qid: string) => {
    for (const n of new Set([fold(name), fold(noParen(name))])) if (n) (byName.get(n) ?? byName.set(n, new Set()).get(n)!).add(qid);
  };
  const capacity = new Map<string, number>();
  for (const f of readdirSync(".probe/outside2/pageprops")) {
    const j = readJson<any>(`.probe/outside2/pageprops/${f}`);
    const back = new Map<string, string>();
    for (const x of j.query?.normalized ?? []) back.set(x.to, x.from);
    for (const x of j.query?.redirects ?? []) back.set(x.to, back.get(x.from) ?? x.from);
    for (const p of j.query?.pages ?? []) {
      const q = p.pageprops?.wikibase_item;
      if (!q) continue;
      add(p.title, q);
      let n: string = p.title;
      for (let hop = 0; back.has(n) && hop < 5; hop++) add((n = back.get(n)!), q);
    }
  }
  for (const f of readdirSync(".probe/outside2/wikidata")) {
    const j = readJson<any>(`.probe/outside2/wikidata/${f}`);
    for (const [id, e] of Object.entries<any>(j.entities ?? {})) {
      if (e.labels?.en?.value) add(e.labels.en.value, id);
      for (const a of e.aliases?.en ?? []) add(a.value, id);
      const amount = e.claims?.P1083?.[0]?.mainsnak?.datavalue?.value?.amount;
      const cap = amount ? Math.round(Number(amount)) : undefined;
      // scripts/outside2.ts itemsOf's bounds: a capacity outside 50 to 120,000 is a data error.
      if (cap && cap >= 50 && cap <= 120_000) capacity.set(id, cap);
    }
  }
  const qidOf = (name: string) => {
    const hits = byName.get(fold(name));
    return hits && hits.size === 1 ? [...hits][0]! : undefined;
  };
  return { qidOf, capacity };
}

type Size = { size: number | null; source: "measured" | "stated" | "none"; measured: number; note: string };

/** A post-cutoff tour's rooms, measured from the cached article and the cached Wikidata items only. */
function postcutSize(t: { title: string; region: RegionId; markets: string[] }, index: ReturnType<typeof cachedVenueIndex>): Size {
  const p = `.probe/outside2/pc-wiki/${sha(t.title).slice(0, 16)}.json`;
  if (!existsSync(p)) return { size: null, source: "none", measured: 0, note: "the article text is not cached" };
  const text: string | undefined = readJson<any>(p).query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content;
  if (!text) return { size: null, source: "none", measured: 0, note: "the cached article has no text" };
  const truth = new Set(t.markets);
  const caps = new Map<string, number>();
  let named = 0;
  for (const r of showRows(text)) {
    if (regionOfCountry(r.country) !== t.region || !r.venue) continue;
    const m = findMarket(r.city, t.region) ?? findMarket(r.city.split(",")[0]!, t.region);
    if (!m || !truth.has(marketId(m))) continue;
    named++;
    const q = index.qidOf(r.venue);
    const c = q ? index.capacity.get(q) : undefined;
    if (q && c) caps.set(q, c);
  }
  const measured = caps.size;
  if (measured < MIN_MEASURED) return { size: null, source: "none", measured, note: `${measured} of the tour's venues have a cached Wikidata capacity (fewer than ${MIN_MEASURED}); ${named} show rows name a venue` };
  return { size: medianCapacity([...caps.values()]), source: "measured", measured, note: `median of ${measured} cached Wikidata capacities` };
}

/* ───────────────── tours ───────────────── */

const RANKINGS = ["population", "model", "qloo", "blend", "modelQloo"] as const;
type Ranking = (typeof RANKINGS)[number];
type HitRow = { hits: number; of: number };
type Tour = { artist: string; set: "bench" | "held-out" | "post-cutoff"; region: RegionId; R: number; rp: Record<Ranking, HitRow> } & Size;

function tours(): Tour[] {
  const crowds = benchCrowds();
  const venues = new Map(readJson<{ subjects: { artist: string; draw: number; measured: number }[] }>("data/outside2/venues-truth.json").subjects.map((s) => [s.artist, s]));
  const older = readJson<{ test1Rows: { artist: string; set: "bench" | "held-out"; region: RegionId; R: number; rp: Record<Ranking, HitRow | null> }[] }>("data/head-to-head/results.json").test1Rows;
  const index = cachedVenueIndex();
  const pc = new Map(readJson<{ taken: { artist: string; title: string; region: RegionId; markets: string[] }[] }>("data/outside2/post-cutoff.json").taken.map((t) => [t.artist, t]));
  const post = readJson<{ postcut: { rows: { artist: string; region: RegionId; R: number; rp: Record<Ranking, HitRow | null> }[] } }>("data/outside2/results.json").postcut.rows;
  const whole = (rp: Record<Ranking, HitRow | null>, who: string) => {
    for (const k of RANKINGS) if (!rp[k]) throw new Error(`${who}: no published ${k} row`);
    return rp as Record<Ranking, HitRow>;
  };
  const out: Tour[] = [];
  for (const r of older) {
    const v = venues.get(r.artist);
    const stated = crowds.get(r.artist);
    const size: Size = v
      ? { size: v.draw, source: "measured", measured: v.measured, note: `venues-truth.json: median of ${v.measured} Wikidata capacities` }
      : r.set === "bench" && stated
        ? { size: stated, source: "stated", measured: 0, note: "no Wikipedia article (press listings only): the usual crowd in scripts/bench.mjs, fixed Oct 8" }
        : { size: null, source: "none", measured: 0, note: "no measured rooms and no stated crowd" };
    out.push({ artist: r.artist, set: r.set, region: r.region, R: r.R, rp: whole(r.rp, r.artist), ...size });
  }
  for (const r of post) {
    const t = pc.get(r.artist);
    if (!t) throw new Error(`${r.artist}: not in data/outside2/post-cutoff.json`);
    out.push({ artist: r.artist, set: "post-cutoff", region: r.region, R: r.R, rp: whole(r.rp, r.artist), ...postcutSize(t, index) });
  }
  return out;
}

/* ───────────────── scoring ───────────────── */

const share = (h: HitRow) => (h.of ? h.hits / h.of : 0);
function contrast(name: string, rows: Tour[], a: Ranking, b: Ranking, seed: number) {
  const d = rows.map((r) => share(r.rp[a]) - share(r.rp[b]));
  const st = signTest(d);
  const ci = meanCI(d, seed);
  return { name, n: d.length, meanA: avg(rows.map((r) => share(r.rp[a]))), meanB: avg(rows.map((r) => share(r.rp[b]))), diff: ci.mean, lo: ci.lo, hi: ci.hi, wins: st.wins, losses: st.losses, ties: st.ties, p: st.p };
}
type Contrast = ReturnType<typeof contrast>;
const pool = (rows: Tour[]) =>
  Object.fromEntries(
    RANKINGS.map((k) => {
      const hits = rows.reduce((n, r) => n + r.rp[k].hits, 0), of = rows.reduce((n, r) => n + r.rp[k].of, 0);
      return [k, { hits, of, share: of ? hits / of : 0 }];
    }),
  );

const PRIMARY: [string, Ranking, Ranking][] = [
  ["Qloo + population vs population", "blend", "population"],
  ["Qloo + population vs the model alone", "blend", "model"],
];
const SECONDARY: [string, Ranking, Ranking][] = [
  ["Qloo vs the model alone", "qloo", "model"],
  ["Qloo vs population", "qloo", "population"],
  ["The model alone vs population", "model", "population"],
  ["The model + Qloo vs the model alone", "modelQloo", "model"],
];

const fmt = (c: Contrast) =>
  `${c.name.padEnd(42)} n=${String(c.n).padStart(2)}  ${(100 * c.meanA).toFixed(1)}% vs ${(100 * c.meanB).toFixed(1)}%  ${(100 * c.diff).toFixed(1)} pts [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]  ${c.wins}-${c.losses}-${c.ties}  p=${c.p.toFixed(3)}`;

function members() {
  const all = tours();
  for (const t of all) console.log(`${t.artist.padEnd(32)} ${t.set.padEnd(11)} ${String(t.size ?? "-").padStart(6)} ${t.source.padEnd(8)} ${isClubAndTheatre(t.size) ? "IN " : "out"}  ${t.note}`);
  const inn = all.filter((t) => isClubAndTheatre(t.size));
  console.log(`in: ${inn.length} (older ${inn.filter((t) => t.set !== "post-cutoff").length}, post-cutoff ${inn.filter((t) => t.set === "post-cutoff").length}); no size: ${all.filter((t) => t.size === null).length}; network calls: ${fetchCalls}`);
  if (fetchCalls !== 0) throw new Error(`${fetchCalls} network calls were attempted`);
}

function score() {
  const all = tours();
  const inn = all.filter((t) => isClubAndTheatre(t.size));
  const groups = {
    pooled: { label: `Club and theatre tours, both sets (real rooms ${CLUB_THEATRE_MAX.toLocaleString("en-US")} or fewer)`, rows: inn, seed: SEED.pooled },
    older: { label: "Of those, the older tours (head-to-head)", rows: inn.filter((t) => t.set !== "post-cutoff"), seed: SEED.older },
    postcut: { label: "Of those, the tours announced after the model's release", rows: inn.filter((t) => t.set === "post-cutoff"), seed: SEED.postcut },
    measuredOnly: { label: "Sensitivity: only tours whose room size was measured, not stated", rows: inn.filter((t) => t.source === "measured"), seed: SEED.pooled },
    rest: { label: `For comparison: the tours over ${CLUB_THEATRE_MAX.toLocaleString("en-US")}`, rows: all.filter((t) => t.size !== null && !isClubAndTheatre(t.size)), seed: SEED.pooled },
  };
  const results = Object.fromEntries(
    Object.entries(groups).map(([k, g]) => [
      k,
      {
        label: g.label,
        n: g.rows.length,
        seed: g.seed,
        primary: g.rows.length ? PRIMARY.map(([n, a, b]) => contrast(n, g.rows, a, b, g.seed)) : [],
        secondary: g.rows.length ? SECONDARY.map(([n, a, b]) => contrast(n, g.rows, a, b, g.seed)) : [],
        pooled: pool(g.rows),
        artists: g.rows.map((r) => r.artist),
      },
    ]),
  );
  if (fetchCalls !== 0) throw new Error(`${fetchCalls} network calls were attempted`);
  const out = {
    scored: new Date().toISOString(),
    protocol: "data/outside2/PROTOCOL-5.md",
    status: "protocol committed before scoring, from offline caches",
    script: "scripts/indie-subset.ts",
    rule: `real rooms ${CLUB_THEATRE_MAX.toLocaleString("en-US")} or fewer: the median Wikidata capacity of the real tour's venues where at least ${MIN_MEASURED} are measured, else the benchmark's stated usual crowd`,
    calls: { qloo: 0, model: 0, network: fetchCalls },
    results,
    tours: all.map((t) => ({ artist: t.artist, set: t.set, region: t.region, R: t.R, size: t.size, sizeSource: t.source, measured: t.measured, note: t.note, inSubset: isClubAndTheatre(t.size), hits: Object.fromEntries(RANKINGS.map((k) => [k, t.rp[k].hits])) })),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  for (const [k, g] of Object.entries(results)) {
    console.log(`\n${k}: ${g.label} (n = ${g.n})`);
    for (const c of [...g.primary, ...g.secondary]) console.log(fmt(c));
    console.log(JSON.stringify(g.pooled));
  }
  console.log(`network calls: ${fetchCalls}`);
}

const stage = process.argv[2] ?? "score";
if (stage === "members") members();
else if (stage === "score") score();
else console.log("stages: members | score");
