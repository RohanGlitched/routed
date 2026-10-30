import h2hRaw from "@/data/head-to-head/results.json";
import secRaw from "@/data/outside2/secondary-markets.json";
import indieRaw from "@/data/outside2/indie-subset.json";
import mpqRaw from "@/data/outside2/model-plus-qloo.json";
import r4Raw from "@/data/outside2/rooms4.json";
import { populationRanking } from "@/lib/headtohead";
import { PROTOCOL_COMMIT, REPO } from "@/lib/headtohead-meta";
import { loadTour } from "@/lib/store";
import s from "@/app/proof/proof.module.css";
import { ContrastTable, type Contrast } from "./HeadToHead";
import { FLAGSHIP } from "./OnlyQloo";
import { OUTSIDE2, POST, PROTOCOL2_COMMIT } from "./PostCutoff";
import { streetCheck } from "./StreetLevel";

/**
 * Oct 30 (round 2 of the judges) on /proof: the one-sentence lead, every test in one table, and round 5 (club and
 * theatre acts only, data/outside2/PROTOCOL-5.md). Every figure is read from the committed results files, and the
 * flagship's from its stored tour record, so the copy can't drift from the data.
 */

type Pool = { hits: number; of: number; share: number };
type Group = { label: string; n: number; primary: Contrast[]; secondary: Contrast[]; pooled: Record<"population" | "model" | "qloo" | "blend" | "modelQloo", Pool>; artists: string[] };
type IndieTour = { artist: string; set: "bench" | "held-out" | "post-cutoff"; R: number; size: number | null; sizeSource: "measured" | "stated" | "none"; inSubset: boolean; hits: Record<"population" | "model" | "qloo" | "blend" | "modelQloo", number> };
type Indie = { results: Record<"pooled" | "older" | "postcut" | "measuredOnly" | "rest", Group>; tours: IndieTour[]; calls: { qloo: number; model: number; network: number } };
const INDIE = indieRaw as unknown as Indie;
export const PROTOCOL5_COMMIT = "2e915c4";
const PROTOCOL3_COMMIT = "d5991e2";
const PROTOCOL4_COMMIT = "7d132d3";

const H2H = h2hRaw as unknown as { test1: { all: { n: number; primary: Contrast[]; secondary: Contrast[] } }; test2: { n: number; primary: Contrast } };
const SEC = secRaw as unknown as { n: number; primary: Contrast[] };
const MPQ = mpqRaw as unknown as { results: { postcut: { contrast: Contrast } } };
const R4 = r4Raw as unknown as { n: number; cities: number; primary: Contrast[]; pooled: Record<"shipped" | "model" | "qloo", { hit1: number; hit3: number; cities: number }> };

const pc1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}`;
const abs1 = (v: number) => Math.abs(v * 100).toFixed(1);
const pv = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);
const sig = (p: number) => (p < 0.05 ? "significant" : "not significant");
const Sig = (p: number) => (p < 0.05 ? "Significant" : "Not significant");
const ahead = (d: number) => (d >= 0 ? "ahead of" : "behind");
const find = (cs: Contrast[], name: string) => cs.find((c) => c.name === name)!;
const wl = (c: Contrast) => `${c.wins}–${c.losses}–${c.ties}`;

/** The flagship's two counts, each with its own baseline, from the stored tour record. */
export async function flagshipCounts() {
  const t = await loadTour(FLAGSHIP).catch(() => null);
  const p = t?.plan;
  if (!t || !p?.guess?.stops.length) return null;
  const theirs = new Set(p.guess.stops.map((x) => x.marketId).filter(Boolean));
  const only = p.stops.filter((x) => !theirs.has(x.marketId)).sort((a, b) => a.score.rank - b.score.rank);
  const pop = populationRanking(p.region);
  const top = only[0];
  return {
    artist: p.artist.name,
    stops: p.stops.length,
    changed: p.qlooDiff?.added.length,
    notModel: only.length,
    top: top ? { city: top.city, fan: top.score.rank, size: pop.indexOf(top.marketId) + 1 || undefined } : undefined,
  };
}

/** The first thing on /proof: the comparison Routed wins, in one sentence, then Qloo alone's figure. */
export async function ProofLead() {
  const bm = POST.blendVsModel, qm = POST.qlooVsModel;
  const f = await flagshipCounts();
  return (
    <div className={s.leadBox}>
      <p className={s.leadLine}>
        The city ranking Routed ships, Qloo + population, is level with the model alone on tours it can&apos;t have read: {pc1(bm.meanA)} of the announced cities against {pc1(bm.meanB)} ({pts(bm.diff)} pts; {bm.wins} artists better, {bm.losses} worse, {bm.ties} level; {sig(bm.p)}).
        {f?.top ? ` It finds cities the model misses: ${f.notModel} of the ${f.stops} on the flagship tour, with ${f.top.city} #${f.top.fan} for her fans${f.top.size ? ` and #${f.top.size} by size` : ""}.` : ""} And Qloo gives what the model can&apos;t: the block, the neighbourhood, the poster runs and the crowd.
      </p>
      <p className={s.leadSecond}>
        Qloo&apos;s heatmap ranking on its own is {abs1(qm.diff)} pts {ahead(qm.diff)} the model alone on the same {qm.n} tours ({wl(qm)}, {sig(qm.p)}). <a href="#checks">Every test in one table</a>.
      </p>
    </div>
  );
}

type Check = { test: string; tours: string; result: string; wlt: string; committed: string; href: string };

/** Every test on the page in one table: what was compared, on how many tours, the result, and whether its protocol came first. */
export function HowWeChecked({ ownRuler }: { ownRuler?: { n: number; routed: number; guess: number } }) {
  const post = OUTSIDE2.postcut;
  const bp = POST.blendVsPop, qm = POST.qlooVsModel, bm = POST.blendVsModel;
  const mq = MPQ.results.postcut.contrast;
  const [sqm, sbp] = SEC.primary as [Contrast, Contrast];
  const ip = INDIE.results.pooled;
  const [ibp, ibm] = ip.primary as [Contrast, Contrast];
  const iqm = find(ip.secondary, "Qloo vs the model alone");
  const all = H2H.test1.all;
  const hbp = find(all.primary, "Qloo + population vs population");
  const hqm = find(all.primary, "Qloo vs the model alone");
  const hbm = find(all.secondary, "Qloo + population vs the model alone");
  const abl = H2H.test2.primary;
  const [r1] = R4.primary as [Contrast];
  const v = OUTSIDE2.venues, sp = OUTSIDE2.support;
  const vqm = find(v.primary, "Qloo vs the model alone");
  const spq = sp.primary[0]!;
  const yes = (c: string) => `Yes (${c})`;
  const offline = (c: string) => `Yes, from offline caches (${c})`;
  const rows: Check[] = [
    { test: "Tours the model can't have read: Qloo + population vs the model alone", tours: `${bm.n}`, result: `${pts(bm.diff)} pts (${pc1(bm.meanA)} vs ${pc1(bm.meanB)}), ${pv(bm.p)}`, wlt: wl(bm), committed: yes(PROTOCOL2_COMMIT), href: "#unread" },
    { test: "Tours the model can't have read: Qloo + population vs population", tours: `${bp.n}`, result: `${pts(bp.diff)} pts, ${pv(bp.p)}`, wlt: wl(bp), committed: yes(PROTOCOL2_COMMIT), href: "#unread" },
    { test: "Tours the model can't have read: Qloo alone vs the model alone", tours: `${qm.n}`, result: `${pts(qm.diff)} pts, ${pv(qm.p)}`, wlt: wl(qm), committed: yes(PROTOCOL2_COMMIT), href: "#unread" },
    { test: "The model + Qloo vs the model alone, same tours", tours: `${mq.n}`, result: `${pts(mq.diff)} pts, ${pv(mq.p)}`, wlt: wl(mq), committed: "No: post hoc", href: "#model-plus-qloo" },
    { test: "Smaller cities only (each region's 25 biggest left out): Qloo + population vs population", tours: `${sbp.n}`, result: `${pts(sbp.diff)} pts, ${pv(sbp.p)}`, wlt: wl(sbp), committed: offline(PROTOCOL3_COMMIT), href: "#smaller-markets" },
    { test: "Smaller cities only: Qloo alone vs the model alone", tours: `${sqm.n}`, result: `${pts(sqm.diff)} pts, ${pv(sqm.p)}`, wlt: wl(sqm), committed: offline(PROTOCOL3_COMMIT), href: "#smaller-markets" },
    { test: "Club and theatre acts (real rooms 3,000 or fewer): Qloo + population vs population", tours: `${ibp.n}`, result: `${pts(ibp.diff)} pts, ${pv(ibp.p)}`, wlt: wl(ibp), committed: offline(PROTOCOL5_COMMIT), href: "#club-theatre" },
    { test: "Club and theatre acts: Qloo + population vs the model alone", tours: `${ibm.n}`, result: `${pts(ibm.diff)} pts, ${pv(ibm.p)}`, wlt: wl(ibm), committed: offline(PROTOCOL5_COMMIT), href: "#club-theatre" },
    { test: "Club and theatre acts: Qloo alone vs the model alone", tours: `${iqm.n}`, result: `${pts(iqm.diff)} pts, ${pv(iqm.p)}`, wlt: wl(iqm), committed: offline(PROTOCOL5_COMMIT), href: "#club-theatre" },
    { test: "Older real tours: Qloo + population vs population", tours: `${hbp.n}`, result: `${pts(hbp.diff)} pts, ${pv(hbp.p)}`, wlt: wl(hbp), committed: yes(PROTOCOL_COMMIT), href: "#head-to-head" },
    { test: "Older real tours: Qloo + population vs the model alone", tours: `${hbm.n}`, result: `${pts(hbm.diff)} pts, ${pv(hbm.p)}`, wlt: wl(hbm), committed: yes(PROTOCOL_COMMIT), href: "#head-to-head" },
    { test: "Older real tours: Qloo alone vs the model alone", tours: `${hqm.n}`, result: `${pts(hqm.diff)} pts, ${pv(hqm.p)}`, wlt: wl(hqm), committed: yes(PROTOCOL_COMMIT), href: "#head-to-head" },
    { test: "Inside the agent: Qloo's table vs the biggest cities", tours: `${abl.n}`, result: `${pc1(abl.meanA)} vs ${pc1(abl.meanB)} of its cities on the real tour, ${pv(abl.p)}`, wlt: wl(abl), committed: yes(PROTOCOL_COMMIT), href: "#head-to-head" },
    { test: "The room Routed books vs the model's first guess", tours: `${R4.n} (${R4.cities} cities)`, result: `the real venue in ${R4.pooled.shipped.hit1} vs ${R4.pooled.model.hit1} cities (Qloo's first room: ${R4.pooled.qloo.hit1}); ${pts(r1.diff)} pts, ${pv(r1.p)}`, wlt: wl(r1), committed: yes(PROTOCOL4_COMMIT), href: "#rooms" },
    streetCheck(),
    { test: "Qloo's room list vs the model alone, real room in the top 3", tours: `${v.n} (${v.cities} cities)`, result: `${v.pooled.qloo.hit3} vs ${v.pooled.model.hit3} cities, ${pv(vqm.p)}`, wlt: wl(vqm), committed: yes(PROTOCOL2_COMMIT), href: "#unread" },
    { test: "Openers: a real support act in the top 5", tours: `${sp.n}`, result: `${sp.pooled.qloo} vs ${sp.pooled.model} tours, ${pv(spq.p)}`, wlt: wl(spq), committed: yes(PROTOCOL2_COMMIT), href: "#unread" },
  ];
  if (ownRuler) rows.push({ test: "On Qloo's own fan map (Qloo's own ruler): Routed vs the model alone, mean fan rank", tours: `${ownRuler.n}`, result: `#${ownRuler.routed.toFixed(1)} vs #${ownRuler.guess.toFixed(1)}`, wlt: "", committed: "No: it shows what Qloo changed, not that Qloo is right", href: "#own-ruler" });
  return (
    <section className={s.secTop} aria-labelledby="checks-title" id="checks">
      <h2 id="checks-title" className={s.h2}>
        How we checked
      </h2>
      <p className={s.lede2}>
        Every test on this page in one table, the losses next to the wins. Scores are against real tours (cities from Wikipedia&apos;s tour articles and press listings), not Qloo&apos;s own data, except the last row. Better, worse and level count artists, or tours where one artist has two. Post-cutoff: {post.n} tours announced after the model&apos;s release on June 4, 2026.
      </p>
      <div className={s.tableWrap}>
        <table className={`${s.table} ${s.narrow}`}>
          <caption className={s.cap}>
            &quot;Protocol committed before&quot; names the commit that fixed its metric and contrasts before it was scored. &quot;From offline caches&quot; means the data were already on disk when the protocol was written; only the scoring came after. The room test&apos;s protocol came before any Qloo call for it.
          </caption>
          <thead>
            <tr>
              <th scope="col">Test</th>
              <th scope="col">Artists</th>
              <th scope="col">Result</th>
              <th scope="col">Better, worse, level</th>
              <th scope="col">Protocol committed before?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.test}>
                <th scope="row">
                  <a href={r.href}>{r.test}</a>
                </th>
                <td>{r.tours}</td>
                <td>
                  <b>{r.result}</b>
                </td>
                <td>{r.wlt}</td>
                <td>{r.committed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const SET = { bench: "Benchmark", "held-out": "Held out", "post-cutoff": "After the cutoff" } as const;

/** Round 5: the tours of club and theatre acts only (data/outside2/PROTOCOL-5.md), offline from the caches. */
export function ClubTheatre() {
  const g = INDIE.results;
  const p = g.pooled;
  const [bp, bm] = p.primary as [Contrast, Contrast];
  const qm = find(p.secondary, "Qloo vs the model alone");
  const restQm = find(g.rest.secondary, "Qloo vs the model alone");
  const mo = g.measuredOnly.primary[0]!;
  const members = INDIE.tours.filter((t) => t.inSubset).sort((a, b) => (a.size ?? 0) - (b.size ?? 0) || a.artist.localeCompare(b.artist));
  const stated = members.filter((t) => t.sizeSource === "stated").length;
  const older = members.filter((t) => t.set !== "post-cutoff").length;
  const named = (k: "pooled" | "older" | "measuredOnly" | "rest", i: number, name: string) => ({ ...g[k].primary[i]!, name });
  return (
    <section className={s.sec} aria-labelledby="club-theatre-title" id="club-theatre">
      <p className={s.flag}>Protocol committed before scoring, from offline caches</p>
      <h2 id="club-theatre-title" className={s.h2}>
        Club and theatre acts only
      </h2>
      <p className={s.lede2}>
        Most tours above are arena acts, and Routed is for acts in rooms of 500 to 3,000. So we{" "}
        <a href={`${REPO}/commit/${PROTOCOL5_COMMIT}`} target="_blank" rel="noreferrer">
          committed a protocol
        </a>{" "}
        and kept only the tours whose real rooms held 3,000 or fewer: the median Wikidata capacity of the tour&apos;s venues where at least two are measured, else, for benchmark tours with no Wikipedia article, the usual crowd fixed for each artist on Oct 8. {p.n} of the 62 tours qualify, {older} of them older tours. Same rankings, same score, from the published hits: {INDIE.calls.qloo} Qloo calls, {INDIE.calls.model} model calls and {INDIE.calls.network} network calls.
      </p>
      <div className={s.stats} data-part="club-stats">
        <div className={`${s.stat} ${s.fire}`}>
          <b>
            {pts(bp.diff)}
            <small> pts</small>
          </b>
          <em className={s.plain}>
            Qloo + population, the ranking Routed ships, is {abs1(bp.diff)} pts {ahead(bp.diff)} population for club and theatre acts. {Sig(bp.p)}.
          </em>
          <span>
            {pc1(bp.meanA)} against {pc1(bp.meanB)}; better for {bp.wins}, worse for {bp.losses}, level for {bp.ties} ({pv(bp.p)}; 95% interval {pts(bp.lo)} to {pts(bp.hi)} pts).
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {pts(bm.diff)}
            <small> pts</small>
          </b>
          <em className={s.plain}>
            The same blend is {abs1(bm.diff)} pts {ahead(bm.diff)} the model alone there. {Sig(bm.p)}.
          </em>
          <span>
            {pc1(bm.meanA)} against {pc1(bm.meanB)}; {wl(bm)} ({pv(bm.p)}). Pooled, each found {p.pooled.blend.hits} of {p.pooled.blend.of} real cities{p.pooled.blend.hits === p.pooled.model.hits ? "" : ` (the model ${p.pooled.model.hits})`}.
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {pts(qm.diff)}
            <small> pts</small>
          </b>
          <em className={s.plain}>
            Qloo&apos;s ranking alone is {abs1(qm.diff)} pts {ahead(qm.diff)} the model alone. {Sig(qm.p)}.
          </em>
          <span>
            {wl(qm)} ({pv(qm.p)}). On the {g.rest.n} tours over 3,000 the same gap is {pts(restQm.diff)} pts ({wl(restQm)}).
          </span>
        </div>
      </div>
      <div className={s.reading}>
        <p>
          <b>For the acts Routed is for, the blend it ships beats city size and is level with the model.</b> Better than population for {bp.wins} of {bp.n} tours and worse for {bp.losses}; against the model alone, {wl(bm)}, not significant. Qloo&apos;s ranking on its own still trails the model, by about half as much as on the bigger tours (a description, not a test).
        </p>
        <p>
          <b>Read it with its limits.</b> {older} of the {p.n} tours are older ones the model may have read about, and {stated} of the {p.n} room sizes are stated, not measured; in the 4 benchmark tours that have both, the stated crowd was below the measured median every time. On the {g.measuredOnly.n} tours with a measured size, the blend&apos;s lead over population holds ({pts(mo.diff)} pts, {wl(mo)}, {pv(mo.p)}).
        </p>
      </div>
      <ContrastTable
        digits={1}
        rows={[...p.primary, ...p.secondary]}
        caption={`The ${p.n} club and theatre tours. Score: share of each real tour's cities found when picking as many as it played (R-precision), averaged per tour. Intervals: 10,000 bootstrap resamples. The first two rows were fixed as primary before scoring.`}
      />
      <ContrastTable
        digits={1}
        rows={[named("older", 0, `Older tours only (${g.older.n}): Qloo + population vs population`), named("older", 1, "Older tours only: Qloo + population vs the model alone"), named("measuredOnly", 0, `Measured room sizes only (${g.measuredOnly.n}): Qloo + population vs population`), named("measuredOnly", 1, "Measured room sizes only: Qloo + population vs the model alone"), named("rest", 0, `For comparison, the tours over 3,000 (${g.rest.n}): Qloo + population vs population`), named("rest", 1, "The tours over 3,000: Qloo + population vs the model alone")]}
        caption="The same comparisons on parts of the subset, and on the tours left out. Reported because the protocol named them; the first table is the test."
      />
      <div className={s.tableWrap}>
        <table className={`${s.table} ${s.narrow}`}>
          <thead>
            <tr>
              <th scope="col">Artist</th>
              <th scope="col">Set</th>
              <th scope="col">Room size</th>
              <th scope="col">R</th>
              <th scope="col">Population</th>
              <th scope="col">Model alone</th>
              <th scope="col">Qloo</th>
              <th scope="col">Qloo + population</th>
            </tr>
          </thead>
          <tbody>
            {members.map((t) => {
              const best = Math.max(t.hits.population, t.hits.model, t.hits.qloo, t.hits.blend);
              const cell = (n: number) => <span className={n === best ? s.best : undefined}>{n}</span>;
              return (
                <tr key={`${t.artist}-${t.set}`}>
                  <th scope="row">{t.artist}</th>
                  <td>{SET[t.set]}</td>
                  <td>
                    {t.size?.toLocaleString("en-US")} <span className={s.dim}>{t.sizeSource === "stated" ? "stated" : "measured"}</span>
                  </td>
                  <td>{t.R}</td>
                  <td>{cell(t.hits.population)}</td>
                  <td>{cell(t.hits.model)}</td>
                  <td>{cell(t.hits.qloo)}</td>
                  <td>{cell(t.hits.blend)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All {p.n}</th>
              <td />
              <td />
              <td>{p.pooled.population.of}</td>
              <td>{p.pooled.population.hits}</td>
              <td>{p.pooled.model.hits}</td>
              <td>{p.pooled.qloo.hits}</td>
              <td>{p.pooled.blend.hits}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={s.history}>
        Protocol: data/outside2/PROTOCOL-5.md. Numbers: data/outside2/indie-subset.json, written by scripts/indie-subset.ts, with every tour&apos;s room size and where it came from. Written up in{" "}
        <a href={`${REPO}/blob/main/data/outside2/RESULTS.md`} target="_blank" rel="noreferrer">
          RESULTS.md
        </a>
        .
      </p>
    </section>
  );
}
