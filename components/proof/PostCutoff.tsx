import raw from "@/data/outside2/results.json";
import h2h from "@/data/head-to-head/results.json";
import { REPO } from "@/lib/headtohead-meta";
import s from "@/app/proof/proof.module.css";
import { ContrastTable, type Contrast } from "./HeadToHead";

/**
 * The second round of outside tests on /proof (Oct 25): tours announced after the model's release, and the venue and
 * support-act tests. Every figure comes from data/outside2/results.json, written by scripts/outside2.ts under the
 * protocol committed first (data/outside2/PROTOCOL.md, commit bcaa653).
 */

type HitRow = { hits: number; of: number; cities: string[] };
type PostRow = {
  artist: string;
  region: "na" | "uk" | "eu";
  tour: string;
  source: string;
  announced?: string;
  created?: string;
  R: number;
  rp: { population: HitRow; model: HitRow; qloo: HitRow; blend: HitRow; modelQloo: HitRow };
};
type Pool = { cities: number; hit1: number; hit3: number; listed: number; medianRank: number };
type Results = {
  usage: { qlooTotal: number; modelCalls: number; dollars: number };
  venues: { n: number; cities: number; primary: Contrast[]; pooled: Record<"qloo" | "routedOrder" | "popular" | "ladder" | "model", Pool> };
  support: { n: number; primary: Contrast[]; pooled: { qloo: number; model: number } };
  postcut: { n: number; walked: number; primary: Contrast[]; secondary: Contrast[]; exploratory: Contrast[]; rows: PostRow[] };
};

export const OUTSIDE2 = raw as unknown as Results;
export const PROTOCOL2_COMMIT = "bcaa653";
export const RESULTS2_URL = `${REPO}/blob/main/data/outside2/RESULTS.md`;

const find = (cs: Contrast[], name: string) => cs.find((c) => c.name === name)!;
const post = OUTSIDE2.postcut;
/** The two primary post-cutoff contrasts, and the shipped blend against the model (secondary). */
export const POST = {
  n: post.n,
  blendVsPop: find(post.primary, "Qloo + population vs population"),
  qlooVsModel: find(post.primary, "Qloo vs the model alone"),
  blendVsModel: find(post.secondary, "Qloo + population vs the model alone"),
};
/** The same Qloo-vs-model contrast on the 49 older tours (the head-to-head), for the "was" figure. */
const OLD_QLOO_VS_MODEL = (h2h as unknown as { test1: { all: { n: number; primary: Contrast[] } } }).test1.all;

const pc1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}`;
const pv = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);
const REGION = { na: "N. America", uk: "UK & Ireland", eu: "Europe" } as const;
/** The exact revision the ground truth was read from. */
const wiki = (u: string) => u.replace(/&action=raw$/, "");

export function PostCutoff() {
  const { blendVsPop: bp, qlooVsModel: qm, blendVsModel: bm } = POST;
  const oldQm = OLD_QLOO_VS_MODEL.primary.find((c) => c.name === "Qloo vs the model alone")!;
  const v = OUTSIDE2.venues;
  const sp = OUTSIDE2.support;
  const rows = [...post.rows].sort((a, b) => a.artist.localeCompare(b.artist));
  const venueRows: [string, Pool][] = [
    ["Qloo, the artist's room ranking (as Routed asks for it)", v.pooled.qloo],
    ["Qloo's rooms in Routed's measuring order", v.pooled.routedOrder],
    ["Qloo places by popularity, no artist signal", v.pooled.popular],
    ["The biggest fitting room on Wikidata", v.pooled.ladder],
    ["The model alone (Nemotron 3 Ultra)", v.pooled.model],
  ];
  return (
    <section className={s.sec} aria-labelledby="unread-title" id="unread">
      <h2 id="unread-title" className={s.h2}>
        Tours the model can&apos;t have read
      </h2>
      <p className={s.lede2}>
        On older tours, the model alone may simply remember the announcement. So on Oct 25 we ran tests where memory helps less, with the{" "}
        <a href={`${REPO}/commit/${PROTOCOL2_COMMIT}`} target="_blank" rel="noreferrer">
          protocol committed
        </a>{" "}
        before any Qloo or model call. The one that removes memory of the tour itself: {post.n} tours announced after Nemotron 3 Ultra&apos;s release on June 4, 2026, found by walking all {post.walked} pages in Wikipedia&apos;s 2026 and 2027 concert-tour categories. As in the head-to-head, each ranking picks as many cities as the tour announced, and the score is how many were right.
      </p>

      <div className={s.stats} data-part="unread-stats">
        <div className={`${s.stat} ${s.fire}`}>
          <b>
            {pts(bp.diff)}
            <small> pts</small>
          </b>
          <span>
            The ranking Routed ships, Qloo + population, against population alone: {pc1(bp.meanA)} of the announced cities against {pc1(bp.meanB)}. Better for {bp.wins} of {bp.n} artists, worse for {bp.losses || "none"} ({pv(bp.p)}).
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {pts(qm.diff)}
            <small> pts</small>
          </b>
          <span>
            Qloo&apos;s ranking against the model alone: {pc1(qm.meanA)} against {pc1(qm.meanB)}, not significant ({qm.wins}–{qm.losses}–{qm.ties}, {pv(qm.p)}). On the {OLD_QLOO_VS_MODEL.n} older tours below it was {pts(oldQm.diff)} pts.
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {pts(bm.diff)}
            <small> pts</small>
          </b>
          <span>
            Qloo + population against the model alone: {pc1(bm.meanA)} against {pc1(bm.meanB)}, not significant ({bm.wins}–{bm.losses}–{bm.ties}, {pv(bm.p)}).
          </span>
        </div>
      </div>

      <div className={s.reading}>
        <p>
          <b>On tours it can&apos;t have read, the model&apos;s lead shrinks to within the noise.</b> The ranking Routed now ships beats population for {bp.wins} of {bp.n} artists and loses for {bp.losses || "none"}. The model alone&apos;s lead over Qloo&apos;s ranking falls from {(-oldQm.diff * 100).toFixed(1)} pts on the older tours to {(-qm.diff * 100).toFixed(1)}, which is not significant. {post.n} tours is a small sample, so read these as a direction, not a final number.
        </p>
        <p>
          <b>Rooms and openers: the model alone wins, by a wide margin.</b> In {v.cities} cities of {v.n} real tours, the room the artist really played was in the top 3 of Qloo&apos;s room ranking (as Routed asks for it) in {v.pooled.qloo.hit3}, and of the model alone&apos;s in {v.pooled.model.hit3}. Qloo&apos;s support pick matched a real opener for {sp.pooled.qloo} of {sp.n} tours, the model&apos;s for {sp.pooled.model}. These are 2023–2025 tours the model may have read about, and it also knows each city&apos;s main rooms. Qloo&apos;s ranking favours rooms where the fans over-index, often small niche places, over the room a tour books. Routed measures every room against the crowd before it books one, and we don&apos;t claim Qloo picks the room or the opener better than the model.
        </p>
      </div>

      <ContrastTable
        digits={1}
        rows={[bp, qm, ...post.secondary, ...post.exploratory]}
        caption={`The ${post.n} tours announced after the model's release. Score: share of each tour's announced cities found when picking as many as it announced (R-precision), averaged per artist. Intervals: 10,000 bootstrap resamples of the artists. The first two rows were fixed as primary before the run; the last (the model and Qloo averaged) is exploratory.`}
      />

      <h3 className={s.h3}>The {post.n} tours</h3>
      <p className={s.note}>Announced cities found by each ranking&apos;s top R (R = the cities the tour announced in that region).</p>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Artist</th>
              <th scope="col">Tour</th>
              <th scope="col">Announced</th>
              <th scope="col">R</th>
              <th scope="col">Population</th>
              <th scope="col">Model alone</th>
              <th scope="col">Qloo</th>
              <th scope="col">Qloo + population</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const best = Math.max(r.rp.population.hits, r.rp.model.hits, r.rp.qloo.hits, r.rp.blend.hits);
              const cell = (h: HitRow) => <span className={h.hits === best ? s.best : undefined}>{h.hits}</span>;
              return (
                <tr key={r.artist}>
                  <th scope="row">{r.artist}</th>
                  <td>
                    <a href={wiki(r.source)} target="_blank" rel="noreferrer">
                      {r.tour}
                    </a>
                    <span className={s.dim}> · {REGION[r.region]}</span>
                  </td>
                  <td>{r.announced ? r.announced : <span className={s.dim}>article created {r.created}</span>}</td>
                  <td>{r.R}</td>
                  <td>{cell(r.rp.population)}</td>
                  <td>{cell(r.rp.model)}</td>
                  <td>{cell(r.rp.qloo)}</td>
                  <td>{cell(r.rp.blend)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className={s.h3}>Venues: which room in a city</h3>
      <p className={s.note}>
        {v.cities} cities, 3 per artist, from {v.n} real tours with named venues. Each method gets the tour&apos;s usual crowd and lists rooms in order.
      </p>
      <div className={s.tableWrap}>
        <table className={`${s.table} ${s.narrow}`}>
          <thead>
            <tr>
              <th scope="col">Method</th>
              <th scope="col">Real room at #1</th>
              <th scope="col">In the top 3</th>
              <th scope="col">Listed at all</th>
            </tr>
          </thead>
          <tbody>
            {venueRows.map(([name, p]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>
                  {p.hit1} <span className={s.dim}>of {p.cities}</span>
                </td>
                <td>{p.hit3}</td>
                <td>{p.listed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={s.history}>
        Every artist, city, list and rank, the model&apos;s answers and every skipped page are in the repository: <a href={RESULTS2_URL} target="_blank" rel="noreferrer">data/outside2/RESULTS.md</a>, with the protocol in data/outside2/PROTOCOL.md. Raw Qloo responses aren&apos;t published. Cost: {OUTSIDE2.usage.qlooTotal} Qloo requests and {OUTSIDE2.usage.modelCalls} model calls, about ${OUTSIDE2.usage.dollars.toFixed(2)} of model time.
      </p>
    </section>
  );
}
