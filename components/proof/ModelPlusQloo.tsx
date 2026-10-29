import mpq from "@/data/outside2/model-plus-qloo.json";
import sec from "@/data/outside2/secondary-markets.json";
import { REPO } from "@/lib/headtohead-meta";
import s from "@/app/proof/proof.module.css";
import { ContrastTable, type Contrast } from "./HeadToHead";

/**
 * Two Oct 30 additions to /proof. (1) The model + Qloo against the model alone, post hoc, from
 * data/outside2/model-plus-qloo.json (scripts/model-plus-qloo.ts). (2) The secondary-market test, protocol committed
 * before scoring from offline caches (data/outside2/PROTOCOL-3.md), from data/outside2/secondary-markets.json. Both are shown
 * whatever they say.
 */

type Group = { label: string; n: number; contrast: Contrast; pooled: { model: { hits: number; of: number }; modelQloo: { hits: number; of: number } } };
type MPQ = { results: Record<"postcut" | "h2h" | "h2hBench" | "h2hHeldOut" | "pooled", Group>; reconciled: { matches: boolean }[]; calls: { qloo: number; model: number; network: number } };
type Hits = { hits: number; of: number; cities: string[] };
type SecRow = { artist: string; region: "na" | "uk" | "eu"; markets: number; R: number; rp: Record<"population" | "model" | "qloo" | "blend" | "modelQloo", Hits> };
type Sec = { n: number; top: number; primary: Contrast[]; secondary: Contrast[]; pooled: Record<"population" | "model" | "qloo" | "blend" | "modelQloo", { hits: number; of: number; share: number }>; rows: SecRow[]; calls: { qloo: number; model: number } };

const M = mpq as unknown as MPQ;
const S = sec as unknown as Sec;
export const PROTOCOL3_COMMIT = "d5991e2";

const pc1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}`;
const abs1 = (v: number) => Math.abs(v * 100).toFixed(1);
const pv = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);
const sig = (p: number) => (p < 0.05 ? "significant" : "not significant");
const ahead = (d: number) => (d >= 0 ? "ahead of" : "behind");

export function ModelPlusQloo() {
  return (
    <>
      <PostHoc />
      <SmallerMarkets />
    </>
  );
}

function PostHoc() {
  const r = M.results;
  const post = r.postcut.contrast, old = r.h2h.contrast, both = r.pooled.contrast;
  const named = (k: keyof MPQ["results"], name: string) => ({ ...r[k].contrast, name });
  return (
    <section className={s.sec} aria-labelledby="mpq-title" id="model-plus-qloo">
      <p className={s.flag}>Post hoc and exploratory, not pre-registered</p>
      <h2 id="mpq-title" className={s.h2}>
        Does Qloo add to the model?
      </h2>
      <p className={s.lede2}>
        The tests above put Qloo against the model. This asks whether Qloo adds to it. Each city&apos;s place in the model&apos;s own ranking and its place in Qloo&apos;s heatmap ranking are averaged, with no weight to tune, and the result is scored against the model&apos;s ranking alone, the same way as above. It reuses the cached rankings, with {M.calls.qloo} Qloo calls, {M.calls.model} model calls and {M.calls.network} network calls. Both earlier tests already listed this comparison as an extra row added after their results, and this rerun matches {M.reconciled.every((x) => x.matches) ? "every artist in both" : "them only in part (see the repository)"}. It was chosen after seeing the data, so read it as a direction.
      </p>
      <div className={s.stats} data-part="mpq-stats">
        <div className={s.stat}>
          <b>
            {pts(post.diff)}
            <small> pts</small>
          </b>
          <em className={s.plain}>
            The model with Qloo averaged in is {abs1(post.diff)} pts {ahead(post.diff)} the model alone, on {post.n} tours announced after the model&apos;s release. Sign test {sig(post.p)}.
          </em>
          <span>
            Better for {post.wins} artists, worse for {post.losses}, level for {post.ties} ({pv(post.p)}; 95% interval {pts(post.lo)} to {pts(post.hi)} pts).
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {pts(old.diff)}
            <small> pts</small>
          </b>
          <em className={s.plain}>
            The same blend is {abs1(old.diff)} pts {ahead(old.diff)} the model alone on {old.n} older tours the model may have read. {sig(old.p)[0]!.toUpperCase() + sig(old.p).slice(1)}.
          </em>
          <span>
            Better for {old.wins}, worse for {old.losses}, level for {old.ties} ({pv(old.p)}).
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {pts(both.diff)}
            <small> pts</small>
          </b>
          <em className={s.plain}>
            Both sets together, {both.n} tours: the blend is {abs1(both.diff)} pts {ahead(both.diff)} the model alone. {sig(both.p)[0]!.toUpperCase() + sig(both.p).slice(1)}.
          </em>
          <span>
            Better for {both.wins}, worse for {both.losses}, level for {both.ties} ({pv(both.p)}).
          </span>
        </div>
      </div>
      <div className={s.reading}>
        <p>
          <b>A hint, not a finding: Qloo may help the model where its memory runs out.</b> On tours the model can&apos;t have read, averaging Qloo in found more of the real cities for {post.wins} of {post.n} artists and fewer for {post.losses}. The interval clears zero, but the sign test doesn&apos;t ({pv(post.p)}), and the comparison was picked after the data. On older tours, which the model may remember, the blend is level with it, and on the smaller cities of the post-cutoff tours (below) it is level too. A fresh test on new tours, fixed in advance, would settle it.
        </p>
      </div>
      <ContrastTable
        digits={1}
        rows={[
          named("postcut", "After the model's release"),
          named("h2h", "Older tours, 2024–2025"),
          named("h2hBench", "Older tours: the benchmark artists (mid-size)"),
          named("h2hHeldOut", "Older tours: the held-out artists (mostly arenas)"),
          named("pooled", "Both sets together"),
        ]}
        caption="The model + Qloo (first) against the model alone (second). Score: share of each real tour's cities found when picking as many as it played (R-precision), averaged per artist. Intervals: 10,000 bootstrap resamples of the artists, with each test's own seed."
      />
    </section>
  );
}

/** The secondary-market test (protocol committed before scoring, from offline caches): each region's 25 biggest markets left out. */
function SmallerMarkets() {
  const [qm, bp] = S.primary as [Contrast, Contrast];
  const mp = S.secondary.find((c) => c.name === "The model alone vs population")!;
  const bm = S.secondary.find((c) => c.name === "Qloo + population vs the model alone")!;
  const rows = [...S.rows].sort((a, b) => a.artist.localeCompare(b.artist));
  const R = rows.map((x) => x.R).sort((a, b) => a - b);
  return (
    <section className={s.sec} aria-labelledby="smaller-markets">
      <p className={s.flag}>Protocol committed before scoring, from offline caches</p>
      <h2 className={s.h2} id="smaller-markets">
        Smaller cities only
      </h2>
      <p className={s.lede2}>
        Routed&apos;s pitch is that Qloo finds the cities that size and memory miss. So we{" "}
        <a href={`${REPO}/commit/${PROTOCOL3_COMMIT}`} target="_blank" rel="noreferrer">
          committed a protocol
        </a>{" "}
        before scoring a narrower test, from caches already on disk (so it fixed the metric before any score, not before the data). On the same {S.n} tours announced after the model&apos;s release, each region&apos;s {S.top} biggest cities are left out of every ranking and every tour. That leaves {R[0]} to {R.at(-1)} cities per tour. Which ranking finds more of the smaller cities a tour announced? It was scored from the same cached answers, with {S.calls.qloo} Qloo calls and {S.calls.model} model calls.
      </p>
      <div className={s.stats} data-part="secondary-stats">
        <div className={s.stat}>
          <b>
            {pts(qm.diff)}
            <small> pts</small>
          </b>
          <em className={s.plain}>
            Qloo&apos;s ranking is {abs1(qm.diff)} pts {ahead(qm.diff)} the model alone on the smaller cities. Sign test {sig(qm.p)}.
          </em>
          <span>
            {pc1(qm.meanA)} against {pc1(qm.meanB)}; better for {qm.wins} artists, worse for {qm.losses}, level for {qm.ties} ({pv(qm.p)}; 95% interval {pts(qm.lo)} to {pts(qm.hi)} pts).
          </span>
        </div>
        <div className={`${s.stat} ${s.fire}`}>
          <b>
            {pts(bp.diff)}
            <small> pts</small>
          </b>
          <em className={s.plain}>
            Qloo + population, the ranking Routed ships, is {abs1(bp.diff)} pts {ahead(bp.diff)} population on the smaller cities. {sig(bp.p)[0]!.toUpperCase() + sig(bp.p).slice(1)}.
          </em>
          <span>
            {pc1(bp.meanA)} against {pc1(bp.meanB)}; better for {bp.wins}, worse for {bp.losses}, level for {bp.ties} ({pv(bp.p)}).
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {pts(bm.diff)}
            <small> pts</small>
          </b>
          <em className={s.plain}>
            Qloo + population is {abs1(bm.diff)} pts {ahead(bm.diff)} the model alone there. {sig(bm.p)[0]!.toUpperCase() + sig(bm.p).slice(1)}.
          </em>
          <span>
            {bm.wins}–{bm.losses}–{bm.ties} ({pv(bm.p)}). The model alone beats population by {abs1(mp.diff)} pts.
          </span>
        </div>
      </div>
      <div className={s.reading}>
        <p>
          <b>This test was meant to find where Qloo beats the model, and it didn&apos;t.</b> On the smaller cities, Qloo&apos;s heatmap ranking found fewer of the announced ones than the model alone: worse for {qm.losses} of {qm.n} artists, better for {qm.wins}. The blend Routed ships beats population there, but so does the model alone, and the two are level. A likely reason: most of these tours are arena and theatre runs, whose smaller stops are metros a model knows. On these tours, what Qloo adds is the order of the cities, not small ones the model misses. The flagship at the top is a mid-size act, where Qloo&apos;s map brought in smaller cities the model left out; one tour is an example, not a test.
        </p>
      </div>
      <ContrastTable
        digits={1}
        rows={[...S.primary, ...S.secondary]}
        caption={`The ${S.n} post-cutoff tours, each region's ${S.top} biggest cities left out. Score: share of the tour's remaining cities found when picking as many as it has (R-precision), averaged per artist. The first two rows were fixed as primary before scoring.`}
      />
      <div className={s.tableWrap}>
        <table className={`${s.table} ${s.narrow}`}>
          <thead>
            <tr>
              <th scope="col">Artist</th>
              <th scope="col">Smaller cities on the tour</th>
              <th scope="col">Population</th>
              <th scope="col">Model alone</th>
              <th scope="col">Qloo</th>
              <th scope="col">Qloo + population</th>
              <th scope="col">Model + Qloo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const best = Math.max(...Object.values(x.rp).map((h) => h.hits));
              const cell = (h: Hits) => (
                <span className={h.hits === best ? s.best : undefined} title={h.cities.join(", ")}>
                  {h.hits}
                </span>
              );
              return (
                <tr key={x.artist}>
                  <th scope="row">{x.artist}</th>
                  <td>
                    {x.R} <span className={s.dim}>of {x.markets}</span>
                  </td>
                  <td>{cell(x.rp.population)}</td>
                  <td>{cell(x.rp.model)}</td>
                  <td>{cell(x.rp.qloo)}</td>
                  <td>{cell(x.rp.blend)}</td>
                  <td>{cell(x.rp.modelQloo)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All {S.n}</th>
              <td>{S.pooled.population.of}</td>
              <td>{S.pooled.population.hits}</td>
              <td>{S.pooled.model.hits}</td>
              <td>{S.pooled.qloo.hits}</td>
              <td>{S.pooled.blend.hits}</td>
              <td>{S.pooled.modelQloo.hits}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={s.history}>
        Protocol: data/outside2/PROTOCOL-3.md. Numbers: data/outside2/secondary-markets.json and model-plus-qloo.json, written by scripts/model-plus-qloo.ts. Both are written up in <a href={`${REPO}/blob/main/data/outside2/RESULTS.md`} target="_blank" rel="noreferrer">RESULTS.md</a>.
      </p>
    </section>
  );
}
