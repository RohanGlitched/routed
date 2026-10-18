import Link from "next/link";
import raw from "@/data/head-to-head/results.json";
import { BENCH_IDS, PROTOCOL_COMMIT, REPO } from "@/lib/headtohead-meta";
import s from "@/app/proof/proof.module.css";

/**
 * The head-to-head on /proof: what Qloo's taste data changes, scored against the cities artists really played.
 * Everything on it comes from data/head-to-head/results.json, written by scripts/head-to-head.ts.
 */

type HitRow = { hits: number; of: number; cities: string[] };
type Contrast = { name: string; n: number; meanA: number; meanB: number; diff: number; lo: number; hi: number; wins: number; losses: number; ties: number; p: number };
type Row = {
  artist: string;
  set: "bench" | "held-out";
  region: "na" | "uk" | "eu";
  tour: string;
  source: string;
  R: number;
  rp: { population: HitRow; model: HitRow | null; qloo: HitRow; blend: HitRow; modelQloo: HitRow | null };
  beyond: { model: HitRow | null; qloo: HitRow; blend: HitRow };
};
type Abl = { artist: string; qloo: number[]; pop: number[]; qlooShare: number; popShare: number; fixedQloo: number; fixedPop: number; routed: { hits: number; of: number }; alone: { hits: number; of: number } };
type Set1 = { n: number; primary: Contrast[]; secondary: Contrast[]; exploratory: Contrast[]; pooled: Record<"population" | "model" | "qloo" | "blend" | "modelQloo", { hits: number; of: number; share: number }>; beyond: Record<"model" | "qloo" | "blend", { hits: number; of: number; share: number }> };
type Results = {
  scored: string;
  usage: { qloo: number; qlooSearches: number; modelCalls: number; tokensIn: number; tokensOut: number; dollars: number } | null;
  test1: { all: Set1; bench: Set1; heldOut: Set1 };
  test1Rows: Row[];
  test2: { n: number; runs: number; primary: Contrast; secondary: Contrast[] };
  test2Rows: Abl[];
};

const R = raw as unknown as Results;
/** How many artists the head-to-head scored. */
export const H2H_ARTISTS = R.test1.all.n;

const pc = (v: number) => `${Math.round(v * 100)}%`;
const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}`;
const pv = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);
const REGION = { na: "N. America", uk: "UK & Ireland", eu: "Europe" } as const;

function ContrastTable({ rows, caption }: { rows: Contrast[]; caption: string }) {
  return (
    <div className={s.tableWrap}>
      <table className={`${s.table} ${s.narrow}`}>
        <caption className={s.cap}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Comparison</th>
            <th scope="col">Artists</th>
            <th scope="col">First / second</th>
            <th scope="col">Difference (95% interval)</th>
            <th scope="col">Artists won, lost, tied</th>
            <th scope="col">Sign test</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.name}>
              <th scope="row">{c.name}</th>
              <td>{c.n}</td>
              <td>
                {pc(c.meanA)} / {pc(c.meanB)}
              </td>
              <td>
                <b>{pts(c.diff)} pts</b> ({pts(c.lo)} to {pts(c.hi)})
              </td>
              <td>
                {c.wins}–{c.losses}–{c.ties}
              </td>
              <td>{pv(c.p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HeadToHead() {
  const { test1, test1Rows, test2, test2Rows } = R;
  const all = test1.all;
  const [blendVsPop, qlooVsModel] = all.primary as [Contrast, Contrast];
  const abl = test2.primary;
  const rows = [...test1Rows].filter((r) => r.rp.model).sort((a, b) => (a.set === b.set ? a.artist.localeCompare(b.artist) : a.set === "bench" ? -1 : 1));
  const hits = (h: HitRow | null, best: number) => (h ? <span className={h.hits === best ? s.best : undefined} title={h.cities.join(", ")}>{h.hits}</span> : "–");
  return (
    <section className={s.sec} aria-labelledby="h2h-title" id="head-to-head">
      <h2 id="h2h-title" className={s.h2}>
        The head-to-head: what Qloo changes, on a ruler Qloo didn&apos;t make
      </h2>
      <p className={s.lede2}>
        {all.n} artists, each with a real headline tour: the {test1.bench.n} benchmark artists, and {test1.heldOut.n} held-out artists nobody here picked (the first {test1.heldOut.n} single-artist tours in Wikipedia&apos;s 2024 and 2025 tour categories, taken in a hash order, with eight or more cities in one region). Four rankings of every touring city in the tour&apos;s region: by population, by the model alone, by Qloo&apos;s heatmap, and Qloo and population averaged. Each picks as many cities as the artist really played; the score is how many were right. The test was{" "}
        <a href={`${REPO}/commit/${PROTOCOL_COMMIT}`} target="_blank" rel="noreferrer">
          committed before it ran
        </a>
        .
      </p>

      <div className={s.stats} data-part="h2h-stats">
        <div className={`${s.stat} ${s.fire}`}>
          <b>
            {pts(blendVsPop.diff)}
            <small> pts</small>
          </b>
          <span>
            Qloo added to population: {pc(blendVsPop.meanA)} of real tour cities found against {pc(blendVsPop.meanB)} for population alone. Better for {blendVsPop.wins} artists, worse for {blendVsPop.losses}, level for {blendVsPop.ties} ({pv(blendVsPop.p)}).
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {pts(qlooVsModel.diff)}
            <small> pts</small>
          </b>
          <span>
            Qloo&apos;s ranking against the model&apos;s own: {pc(qlooVsModel.meanA)} against {pc(qlooVsModel.meanB)}. Better for {qlooVsModel.wins}, worse for {qlooVsModel.losses}, level for {qlooVsModel.ties} ({pv(qlooVsModel.p)}).
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {pts(abl.diff)}
            <small> pts</small>
          </b>
          <span>
            The agent itself, Qloo&apos;s table swapped for population (same model, prompt and rules, {test2.n} benchmark tours, {test2.runs} runs each): {pc(abl.meanA)} of its eight cities on the real tour with Qloo, {pc(abl.meanB)} without ({abl.wins}–{abl.losses}–{abl.ties}, {pv(abl.p)}).
          </span>
        </div>
      </div>

      <H2HReading />

      <ContrastTable rows={[...all.primary, ...all.secondary, ...all.exploratory]} caption={`All ${all.n} artists. Score: share of the real tour's cities found when picking as many as the artist played (R-precision), averaged per artist. Intervals: 10,000 bootstrap resamples of the artists. The first two rows are the comparisons fixed before the run; the last (the model and Qloo averaged) was added after the results and is weaker evidence.`} />
      <ContrastTable rows={[...test1.bench.primary.map((c) => ({ ...c, name: `Benchmark: ${c.name}` })), ...test1.heldOut.primary.map((c) => ({ ...c, name: `Held out: ${c.name}` }))]} caption={`The two primary comparisons, split: the ${test1.bench.n} benchmark artists (mid-size, chosen Oct 8 for range), then the ${test1.heldOut.n} held-out artists (mostly arena acts, the kind Wikipedia writes tour articles about).`} />

      <h3 className={s.h3}>Artist by artist</h3>
      <p className={s.note}>
        Real-tour cities found by each ranking&apos;s top R (R = cities on the real tour in that region; hover for which). &ldquo;Beyond the biggest&rdquo;: of the real tour&apos;s cities that aren&apos;t among the region&apos;s R biggest, how many Qloo&apos;s ranking found, and the model&apos;s.
      </p>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Artist</th>
              <th scope="col">Real tour</th>
              <th scope="col">R</th>
              <th scope="col">Population</th>
              <th scope="col">Model alone</th>
              <th scope="col">Qloo</th>
              <th scope="col">Qloo + population</th>
              <th scope="col">Beyond the biggest: Qloo / model</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const best = Math.max(r.rp.population.hits, r.rp.model?.hits ?? 0, r.rp.qloo.hits, r.rp.blend.hits);
              const id = BENCH_IDS[r.artist];
              return (
                <tr key={r.artist}>
                  <th scope="row">{id ? <Link href={`/tour/${id}`}>{r.artist}</Link> : r.artist}</th>
                  <td>
                    <a href={r.source.replace(/&action=raw$/, "").replace("/w/index.php?title=", "/wiki/")} target="_blank" rel="noreferrer">
                      {r.tour}
                    </a>
                    <span className={s.dim}>
                      {" "}
                      · {REGION[r.region]}
                      {r.set === "held-out" ? " · held out" : ""}
                    </span>
                  </td>
                  <td>{r.R}</td>
                  <td>{hits(r.rp.population, best)}</td>
                  <td>{hits(r.rp.model, best)}</td>
                  <td>{hits(r.rp.qloo, best)}</td>
                  <td>{hits(r.rp.blend, best)}</td>
                  <td>
                    {r.beyond.qloo.hits} / {r.beyond.model?.hits ?? "–"} <span className={s.dim}>of {r.beyond.qloo.of}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All {all.n}</th>
              <td />
              <td>{all.pooled.population.of}</td>
              <td>{all.pooled.population.hits}</td>
              <td>{all.pooled.model.hits}</td>
              <td>{all.pooled.qloo.hits}</td>
              <td>{all.pooled.blend.hits}</td>
              <td>
                {all.beyond.qloo.hits} / {all.beyond.model.hits} <span className={s.dim}>of {all.beyond.qloo.of}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3 className={s.h3}>The agent with Qloo taken out</h3>
      <p className={s.note}>
        Routed&apos;s own shortlist step and city rules, run {test2.runs} times per arm on the benchmark tours&apos; inputs. Arm Q gets Qloo&apos;s table and audience line, exactly as Routed does; arm P gets the region&apos;s biggest cities and the artist&apos;s name, and is told to prefer where the artist would draw best. Rooms aren&apos;t looked up in either arm, so only the choice of cities differs. Cities of eight on the real tour, each run; then the fixed plan (no model) on each ranking, and the stored Oct 15 tours.
      </p>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Artist</th>
              <th scope="col">Agent, Qloo table</th>
              <th scope="col">Agent, population table</th>
              <th scope="col">Fixed plan: Qloo / population</th>
              <th scope="col">Oct 15: Routed / model alone</th>
            </tr>
          </thead>
          <tbody>
            {[...test2Rows]
              .sort((a, b) => a.artist.localeCompare(b.artist))
              .map((a) => (
                <tr key={a.artist}>
                  <th scope="row">{BENCH_IDS[a.artist] ? <Link href={`/tour/${BENCH_IDS[a.artist]}`}>{a.artist}</Link> : a.artist}</th>
                  <td className={a.qlooShare > a.popShare ? s.best : undefined}>{a.qloo.join(", ")}</td>
                  <td className={a.popShare > a.qlooShare ? s.best : undefined}>{a.pop.join(", ")}</td>
                  <td>
                    {a.fixedQloo} / {a.fixedPop}
                  </td>
                  <td>
                    {a.routed.hits} / {a.alone.hits}
                    {a.alone.of !== 8 ? <span className={s.dim}> of {a.alone.of}</span> : null}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <ContrastTable rows={[test2.primary, ...test2.secondary]} caption={`The ${test2.n} benchmark tours. Score: share of the eight cities on the artist's real tour, averaged over the ${test2.runs} runs per arm.`} />

      <div className={s.cols}>
        <div>
          <h3 className={s.h3}>How it was run</h3>
          <p>
            Ground truth: the cities each artist played on one recent headline tour. The benchmark artists&apos; tours are the ones already on file (data/real-tours.json, compiled Oct 15); the held-out tours are read off their Wikipedia articles by a fixed rule (tables with a City column; festivals, cancelled and postponed shows left out; towns placed by their coordinates within 60 km of a touring city). The full list of pages skipped and why is in the repository.
          </p>
          <p>
            Rankings: population is the metro population of every touring city (GeoNames). The model alone is Nemotron 3 Ultra asked for the 50 cities where the artist would sell the most tickets, from its own knowledge. Qloo is the artist&apos;s heatmap ranking exactly as Routed computes it (one polygon per region; affinity times taste signal). Qloo + population averages a city&apos;s two places, with no weight to tune. Each ranking is completed by population past the end of its own list.
          </p>
          <p>
            Cost: {R.usage ? `${R.usage.qloo + R.usage.qlooSearches} Qloo requests (${R.usage.qlooSearches} artist searches and one heatmap per held-out artist; the benchmark artists' heatmaps were already stored with their tours), ${R.usage.modelCalls} model calls and ${Math.round((R.usage.tokensIn + R.usage.tokensOut) / 1000)}k tokens, about $${R.usage.dollars.toFixed(2)} at Token Factory's list price` : "see the repository"}. Code: scripts/head-to-head.ts (the protocol is its header); scoring: lib/headtohead.ts, with tests. The model's answers are in data/head-to-head/model-runs.json; Qloo's responses aren&apos;t published.
          </p>
        </div>
        <div>
          <h3 className={s.h3}>What it can&apos;t show</h3>
          <p>
            A past tour is one booker&apos;s answer, made with ticket data neither side has, and it rewards the big cities every tour plays. The model may have read these tours&apos; announcements, which favours it; Qloo&apos;s signals may include check-ins at these very shows, which favours Qloo. Wikipedia writes tour articles about big acts, so the held-out artists lean to arenas, where population is hard to beat; the benchmark artists are closer to who Routed is for. One tour per artist, {all.n} artists: differences of a few points are within the noise, and the intervals say so.
          </p>
        </div>
      </div>
    </section>
  );
}

/** The plain-words reading of the result, written after the run; every figure comes from results.json. */
function H2HReading() {
  const { all, bench, heldOut } = R.test1;
  const [bp, qm] = all.primary as [Contrast, Contrast];
  const [, mp, bm] = all.secondary as [Contrast, Contrast, Contrast];
  const mq = all.exploratory[0]!;
  const a = R.test2.primary;
  return (
    <div className={s.reading}>
      <p>
        <b>Qloo&apos;s taste data knows something population doesn&apos;t.</b> Added to population, it found {pc(bp.meanA)} of the cities artists really played, against {pc(bp.meanB)}: better for {bp.wins} of {bp.n} artists, worse for {bp.losses} ({pv(bp.p)}). It holds on both sets: {pts(bench.primary[0]!.diff)} points on the benchmark artists ({bench.primary[0]!.wins}–{bench.primary[0]!.losses}) and {pts(heldOut.primary[0]!.diff)} on the held-out ones ({heldOut.primary[0]!.wins}–{heldOut.primary[0]!.losses}). Nothing Qloo made went into the ruler, so this is not Qloo grading Qloo.
      </p>
      <p>
        <b>The model alone knows more.</b> Its own ranking found {pc(qm.meanB)}, ahead of Qloo&apos;s ranking for {qm.losses} artists ({pts(-qm.diff)} points) and of Qloo and population together for {bm.losses} ({pts(-bm.diff)} points); against population alone it is {pts(mp.diff)}. A model that has read these tours&apos; announcements can recite where artists play. Averaged with Qloo&apos;s ranking it found {pc(mq.meanA)} ({pts(mq.diff)} points, {pv(mq.p)}; added after the results): on this ruler, Qloo doesn&apos;t add to what the model already knows.
      </p>
      <p>
        <b>Inside the agent, eight picks can&apos;t tell them apart.</b> With Qloo&apos;s table swapped for the biggest cities, {pc(a.meanB)} of the agent&apos;s cities were on the real tour; with Qloo&apos;s, {pc(a.meanA)} ({pts(a.diff)} points, {a.wins}–{a.losses}–{a.ties}, {pv(a.p)}). What Qloo changes in a Routed tour is what this ruler doesn&apos;t score: cities where the fans over-index rather than where bookers have gone, the rooms those fans go to, the neighbourhood and the support act.
      </p>
    </div>
  );
}
