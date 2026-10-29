// The model + Qloo, against the model alone: post hoc and exploratory, not pre-registered.
//
// Usage (from routed/; no keys are read and no network call is made, so it needs no .env):
//   npx tsx scripts/model-plus-qloo.ts             # data/outside2/model-plus-qloo.json (post hoc)
//   npx tsx scripts/model-plus-qloo.ts secondary   # data/outside2/secondary-markets.json (pre-registered: PROTOCOL-3.md)
//
// What it asks. Routed's tests so far compare Qloo with the model alone, or Qloo + population with population. A
// judge's question is different: does Qloo add anything to the model? Here each market's place in the model's own
// city ranking and its place in Qloo's heatmap ranking are averaged (lib/headtohead.ts blendTwo, no weight to tune,
// ties to the bigger city), and that blend is scored against the model's ranking alone by R-precision against the
// real tours, on the same two sets the published tests use:
//   - the 13 tours announced after the model's release (data/outside2, Test 3), and
//   - the 49 older tours of the head-to-head (data/head-to-head, Test 1).
// Both published tests already carried this contrast as an exploratory row, decided after their results were seen
// (outside2: +5.8 pts, 7-1-5; head-to-head: -0.8 pts, 13-20-16). This script recomputes both from the cached
// rankings alone, checks every artist's hits against the published rows, and adds the two sets pooled. Nothing here
// was fixed before the data were seen, so it is evidence of a direction only.
//
// Inputs, all cached or committed: the model's answers (data/outside2/model-runs.json, data/head-to-head/model-runs.json);
// Qloo's rankings as stored market ids (.probe/outside2/postcut/qloo, .probe/h2h/qloo, gitignored); Wikipedia
// coordinates the published runs already fetched to place the model's towns (.probe/*/coords). A missing cache file
// is an error, never a fetch: fetch itself is replaced by a function that throws, and the script asserts at the end
// that it was never called. The output carries only derived ranks and hit counts.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls++;
  throw new Error("model-plus-qloo is offline: no network call is allowed");
}) as typeof fetch;

const { CA_ABBR, findMarket, marketById, marketId, nearestMarket, US_STATES } = await import("../lib/geo/markets.ts");
const { avg, blendRanking, blendTwo, completeRanking, meanCI, populationRanking, rPrecision, secondaryRPrecision, SECONDARY_TOP, signTest } = await import("../lib/headtohead.ts");
const { realMarkets, realTourFor } = await import("../lib/outside.ts");
const { BENCH_IDS } = await import("../lib/headtohead-meta.ts");
type RegionId = "na" | "uk" | "eu";

const OUT = "data/outside2/model-plus-qloo.json";
/** The bootstrap seeds the two published tests used, so the recomputed rows match theirs to the digit. */
const SEED = { postcut: 20261025, h2h: 20261018, pooled: 20261025 } as const;

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** The two scripts fold names slightly differently ("&" becomes "and" only in outside2); each cache uses its own. */
const foldH2h = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const foldO2 = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const slugH2h = (s: string) => foldH2h(s).replace(/ /g, "-");
const slugO2 = (s: string) => foldO2(s).replace(/ /g, "-");

function need<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`cache missing (offline, so not fetched): ${path}`);
  return readJson<T>(path);
}

/** Wikipedia coordinates exactly as the published runs read them (batches of 40, keyed by a hash), from the cache only. */
function coordinates(dir: string, names: string[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (let i = 0; i < names.length; i += 40) {
    const batch = names.slice(i, i + 40);
    const j = need<any>(`${dir}/coords/${sha(batch.join("|")).slice(0, 16)}.json`);
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

/** The model's towns placed on touring markets the way both published scripts place them (placeModelCities). */
export function placeModelCities(dir: string, named: { city: string; area: string }[], region: RegionId): (string | null)[] {
  const byName = named.map((c) => findMarket(`${c.city}, ${c.area}`, region) ?? findMarket(c.city, region));
  const titles = (c: { city: string; area: string }) => {
    const a = c.area.trim();
    const full = US_STATES[a.toUpperCase()] ? US_STATES[a.toUpperCase()]!.replace(/(^|\s)\w/g, (x: string) => x.toUpperCase()) : Object.entries(CA_ABBR).find(([, v]) => v === a.toUpperCase())?.[0] ?? a;
    return region === "na" ? [`${c.city}, ${full}`, c.city] : [c.city, `${c.city}, ${a}`];
  };
  const want = [...new Set(named.filter((_, i) => !byName[i]).flatMap(titles))];
  const at = coordinates(dir, want);
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

/** One tour, with everything a ranking needs. Exported shape is shared with the secondary-market stage. */
export type Subject = { artist: string; set: "post-cutoff" | "bench" | "held-out"; region: RegionId; truth: Set<string>; model: string[]; qloo: string[] };

export function postcutSubjects(): Subject[] {
  const pc = readJson<{ taken: { artist: string; region: RegionId; markets: string[] }[] }>("data/outside2/post-cutoff.json");
  const runs = readJson<{ postcut: { artist: string; named: { city: string; area: string }[] }[] }>("data/outside2/model-runs.json").postcut;
  return pc.taken.map((t) => {
    const named = runs.find((r) => r.artist === t.artist)?.named;
    if (!named) throw new Error(`${t.artist}: no model answer in data/outside2/model-runs.json`);
    const qloo = need<{ ids: string[] }>(`.probe/outside2/postcut/qloo/${slugO2(t.artist)}.json`).ids;
    return { artist: t.artist, set: "post-cutoff" as const, region: t.region, truth: new Set(t.markets), model: completeRanking(placeModelCities(".probe/outside2", named, t.region), t.region), qloo };
  });
}

export function h2hSubjects(): Subject[] {
  const runs = readJson<{ runs: { artist: string; ranking: { city: string; area: string }[] | null }[] }>("data/head-to-head/model-runs.json").runs;
  const out: Subject[] = [];
  const add = (artist: string, set: "bench" | "held-out", region: RegionId, truth: Set<string>) => {
    const named = runs.find((r) => r.artist === artist)?.ranking;
    if (!named) return; // the published test scores only artists the model answered for
    const qloo = need<{ ids: string[] }>(`.probe/h2h/qloo/${slugH2h(artist)}.json`).ids;
    out.push({ artist, set, region, truth, model: completeRanking(placeModelCities(".probe/h2h", named, region), region), qloo });
  };
  for (const artist of Object.keys(BENCH_IDS)) {
    const real = realTourFor(artist);
    if (real) add(artist, "bench", real.region, realMarkets(real));
  }
  for (const h of readJson<{ taken: { artist: string; region: RegionId; markets: string[] }[] }>("data/head-to-head/held-out.json").taken) add(h.artist, "held-out", h.region, new Set(h.markets));
  return out;
}

export function contrast(name: string, a: number[], b: number[], seed: number) {
  const d = a.map((x, i) => x - b[i]!);
  const st = signTest(d);
  const ci = meanCI(d, seed);
  return { name, n: d.length, meanA: avg(a), meanB: avg(b), diff: ci.mean, lo: ci.lo, hi: ci.hi, wins: st.wins, losses: st.losses, ties: st.ties, p: st.p };
}
export type Contrast = ReturnType<typeof contrast>;

const label = (id: string) => marketById(id)?.name ?? id;
const share = (h: { hits: number; of: number }) => (h.of ? h.hits / h.of : 0);

function scoreRows(subjects: Subject[]) {
  return subjects.map((s) => {
    const M = s.model;
    const MQ = blendTwo(M, s.qloo, s.region);
    const m = rPrecision(M, s.truth), mq = rPrecision(MQ, s.truth);
    const gained = mq.ids.filter((id) => !m.ids.includes(id)).map(label);
    const lost = m.ids.filter((id) => !mq.ids.includes(id)).map(label);
    return { artist: s.artist, set: s.set, region: s.region, R: s.truth.size, model: m.hits, modelQloo: mq.hits, gained, lost };
  });
}
type ScoredRow = ReturnType<typeof scoreRows>[number];

function check(rows: ScoredRow[], published: { artist: string; rp: { model: { hits: number } | null; modelQloo: { hits: number } | null } }[], where: string) {
  const bad: string[] = [];
  for (const r of rows) {
    const p = published.find((x) => x.artist === r.artist);
    if (!p?.rp.model || !p.rp.modelQloo) bad.push(`${r.artist}: no published row`);
    else if (p.rp.model.hits !== r.model || p.rp.modelQloo.hits !== r.modelQloo) bad.push(`${r.artist}: model ${r.model} vs ${p.rp.model.hits}, model + Qloo ${r.modelQloo} vs ${p.rp.modelQloo.hits}`);
  }
  if (published.filter((x) => x.rp.model).length !== rows.length) bad.push(`${rows.length} rows here, ${published.filter((x) => x.rp.model).length} published`);
  return { against: where, rows: rows.length, matches: bad.length === 0, differences: bad };
}

const fmt = (c: Contrast) =>
  `${c.name.padEnd(58)} n=${c.n}  ${(100 * c.meanA).toFixed(1)}% vs ${(100 * c.meanB).toFixed(1)}%  ${(100 * c.diff).toFixed(1)} pts [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]  ${c.wins}-${c.losses}-${c.ties}  p=${c.p.toFixed(3)}`;

function f6() {
  const post = scoreRows(postcutSubjects());
  const old = scoreRows(h2hSubjects());
  const v = (rows: ScoredRow[], k: "model" | "modelQloo") => rows.map((r) => share({ hits: r[k], of: r.R }));
  const pool = (rows: ScoredRow[], k: "model" | "modelQloo") => {
    const hits = rows.reduce((n, r) => n + r[k], 0), of = rows.reduce((n, r) => n + r.R, 0);
    return { hits, of, share: of ? hits / of : 0 };
  };
  const NAME = "The model + Qloo vs the model alone";
  const sets = {
    postcut: { label: "Tours announced after the model's release (outside2, Test 3)", rows: post, contrast: contrast(NAME, v(post, "modelQloo"), v(post, "model"), SEED.postcut) },
    h2h: { label: "Older tours, 2024–2025 (the head-to-head, Test 1)", rows: old, contrast: contrast(NAME, v(old, "modelQloo"), v(old, "model"), SEED.h2h) },
    h2hBench: { label: "Older tours: the 19 benchmark artists (mid-size acts)", rows: old.filter((r) => r.set === "bench"), contrast: contrast(NAME, v(old.filter((r) => r.set === "bench"), "modelQloo"), v(old.filter((r) => r.set === "bench"), "model"), SEED.h2h) },
    h2hHeldOut: { label: "Older tours: the 30 held-out artists (mostly arena acts)", rows: old.filter((r) => r.set === "held-out"), contrast: contrast(NAME, v(old.filter((r) => r.set === "held-out"), "modelQloo"), v(old.filter((r) => r.set === "held-out"), "model"), SEED.h2h) },
    pooled: { label: "Both sets together (62 tours; one artist can appear in both with different tours)", rows: [...post, ...old], contrast: contrast(NAME, v([...post, ...old], "modelQloo"), v([...post, ...old], "model"), SEED.pooled) },
  };
  const reconciled = [
    check(post, readJson<any>("data/outside2/results.json").postcut.rows, "data/outside2/results.json postcut.rows (exploratory row: +5.8 pts, 7-1-5)"),
    check(old, readJson<any>("data/head-to-head/results.json").test1Rows, "data/head-to-head/results.json test1Rows (exploratory row: -0.8 pts, 13-20-16)"),
  ];
  if (fetchCalls !== 0) throw new Error(`${fetchCalls} network calls were attempted`);
  const out = {
    scored: new Date().toISOString(),
    status: "post hoc, exploratory, not pre-registered",
    script: "scripts/model-plus-qloo.ts",
    question: "Does averaging Qloo's heatmap ranking into the model's own city ranking find more of a real tour's cities than the model's ranking alone?",
    method: "Each market's place in the model's ranking (completed by population) and in Qloo's heatmap ranking (completed by population) averaged, ties to the bigger city (lib/headtohead.ts blendTwo); R-precision against the real tour's markets in its region (lib/headtohead.ts rPrecision); per-artist paired differences, exact two-sided sign test, mean with a 95% percentile bootstrap interval (10,000 resamples).",
    seeds: SEED,
    calls: { qloo: 0, model: 0, network: fetchCalls },
    reconciled,
    results: Object.fromEntries(Object.entries(sets).map(([k, s]) => [k, { label: s.label, n: s.rows.length, contrast: s.contrast, pooled: { model: pool(s.rows, "model"), modelQloo: pool(s.rows, "modelQloo") } }])),
    rows: { postcut: post, h2h: old },
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  for (const [k, s] of Object.entries(sets)) console.log(k.padEnd(8), fmt(s.contrast), JSON.stringify(out.results[k as keyof typeof sets].pooled));
  for (const r of reconciled) console.log(r.matches ? "matches" : "DIFFERS", r.against, r.differences.join("; "));
  console.log(`network calls: ${fetchCalls}`);
}

/* ───────────────── secondary markets: pre-registered in data/outside2/PROTOCOL-3.md ───────────────── */

/** A tour needs this many of its markets outside the region's 25 biggest to be scored (PROTOCOL-3.md). */
const SECONDARY_MIN = 3;
const SECONDARY_OUT = "data/outside2/secondary-markets.json";

type Hits = { hits: number; of: number; cities: string[] };
type SecondaryRow = { artist: string; region: RegionId; markets: number; R: number; rp: Record<"population" | "model" | "qloo" | "blend" | "modelQloo", Hits> };

function secondary() {
  const rows: SecondaryRow[] = [];
  const skipped: { artist: string; reason: string }[] = [];
  for (const s of postcutSubjects()) {
    const big = new Set(populationRanking(s.region).slice(0, SECONDARY_TOP));
    const R = [...s.truth].filter((id) => !big.has(id)).length;
    if (R < SECONDARY_MIN) {
      skipped.push({ artist: s.artist, reason: `${R} of the tour's markets are outside the region's ${SECONDARY_TOP} biggest (fewer than ${SECONDARY_MIN})` });
      continue;
    }
    const rankings = {
      population: populationRanking(s.region),
      model: s.model,
      qloo: completeRanking(s.qloo, s.region),
      blend: blendRanking(s.qloo, s.region),
      modelQloo: blendTwo(s.model, s.qloo, s.region),
    };
    const rp = Object.fromEntries(
      Object.entries(rankings).map(([k, r]) => {
        const h = secondaryRPrecision(r, s.truth, s.region);
        return [k, { hits: h.hits, of: h.of, cities: h.ids.map(label) }];
      }),
    ) as SecondaryRow["rp"];
    rows.push({ artist: s.artist, region: s.region, markets: s.truth.size, R, rp });
  }
  const v = (k: keyof SecondaryRow["rp"]) => rows.map((r) => share(r.rp[k]));
  const pool = (k: keyof SecondaryRow["rp"]) => {
    const hits = rows.reduce((n, r) => n + r.rp[k].hits, 0), of = rows.reduce((n, r) => n + r.rp[k].of, 0);
    return { hits, of, share: of ? hits / of : 0 };
  };
  const seed = SEED.postcut;
  const primary = [contrast("Qloo vs the model alone", v("qloo"), v("model"), seed), contrast("Qloo + population vs population", v("blend"), v("population"), seed)];
  const secondaryRows = [
    contrast("Qloo vs population", v("qloo"), v("population"), seed),
    contrast("The model alone vs population", v("model"), v("population"), seed),
    contrast("Qloo + population vs the model alone", v("blend"), v("model"), seed),
    contrast("The model + Qloo vs the model alone", v("modelQloo"), v("model"), seed),
  ];
  if (fetchCalls !== 0) throw new Error(`${fetchCalls} network calls were attempted`);
  const out = {
    scored: new Date().toISOString(),
    protocol: "data/outside2/PROTOCOL-3.md",
    script: "scripts/model-plus-qloo.ts secondary",
    top: SECONDARY_TOP,
    minimum: SECONDARY_MIN,
    seed,
    calls: { qloo: 0, model: 0, network: fetchCalls },
    n: rows.length,
    primary,
    secondary: secondaryRows,
    pooled: Object.fromEntries((["population", "model", "qloo", "blend", "modelQloo"] as const).map((k) => [k, pool(k)])),
    rows,
    skipped,
  };
  writeFileSync(SECONDARY_OUT, JSON.stringify(out, null, 1) + "\n");
  for (const c of [...primary, ...secondaryRows]) console.log(fmt(c));
  console.log(JSON.stringify(out.pooled), `skipped ${skipped.length}`, `network calls: ${fetchCalls}`);
}

const stage = process.argv[2] ?? "f6";
if (stage === "f6") f6();
else if (stage === "secondary") secondary();
else console.log("stages: f6 | secondary");
