import raw from "@/data/outside2/rooms4.json";
import { REPO } from "@/lib/headtohead-meta";
import s from "@/app/proof/proof.module.css";
import { ContrastTable, type Contrast } from "./HeadToHead";

/**
 * Round 4 on /proof: the room Routed actually books (the agent's named rooms found on Qloo, measured, the Wikidata
 * ladder, the size rule) on round 2's 102 cities, under data/outside2/PROTOCOL-4.md (committed before any Qloo call
 * for it). Every figure comes from data/outside2/rooms4.json, written by scripts/rooms4.ts. Shown whatever it says.
 */

type Pool = { cities: number; hit1: number; hit3: number; listed: number };
type Arm = "shipped" | "shippedNoChoice" | "popAffinity" | "qloo" | "popular" | "ladder" | "model";
type R4 = {
  n: number;
  cities: number;
  usage: { qloo: number; qlooCap: number; modelCalls: number };
  primary: Contrast[];
  secondary: Contrast[];
  pooled: Record<Arm, Pool>;
  sources: { cities: number; booked: number; fromQlooList: number; fromAgentNames: number; fromLadder: number; agentsChoice: number; measured: number };
};

const R = raw as unknown as R4;
export const PROTOCOL4_COMMIT = "7d132d3";

const pc1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}`;
const abs1 = (v: number) => Math.abs(v * 100).toFixed(1);
const pv = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);
const sig = (p: number) => (p < 0.05 ? "Significant" : "Not significant");
const ahead = (d: number) => (d >= 0 ? "ahead of" : "behind");

export function RoomPick() {
  const [b1, b3, pa] = R.primary as [Contrast, Contrast, Contrast];
  const vsQloo = R.secondary.find((c) => c.name === "Routed's booked room vs Qloo's first room, hit@1")!;
  const p = R.pooled;
  const src = R.sources;
  const rows: [string, Pool][] = [
    ["The room Routed books, then the rest in its order", p.shipped],
    ["The same, with no agent choice", p.shippedNoChoice],
    ["Qloo's rooms by popularity and fan affinity together", p.popAffinity],
    ["Qloo, the artist's room ranking", p.qloo],
    ["Qloo places by popularity, no artist signal", p.popular],
    ["The biggest fitting room on Wikidata", p.ladder],
    ["The model alone (Nemotron 3 Ultra)", p.model],
  ];
  return (
    <section className={s.sec} aria-labelledby="rooms-title" id="rooms">
      <p className={s.flag}>Pre-registered</p>
      <h2 id="rooms-title" className={s.h2}>
        The room Routed actually books
      </h2>
      <p className={s.lede2}>
        The venue test above scored Qloo&apos;s room list as Routed asks for it. Routed doesn&apos;t book from that list alone. The agent names two rooms per city, and each joins once Qloo finds it there. The rooms are measured, Wikidata&apos;s rooms of the right size are looked up when nothing fits, and a size rule books one. We{" "}
        <a href={`${REPO}/commit/${PROTOCOL4_COMMIT}`} target="_blank" rel="noreferrer">
          committed a protocol
        </a>{" "}
        and replayed that flow on the same {R.cities} cities, reusing the model&apos;s cached answers: {R.usage.qloo} Qloo requests (of a {R.usage.qlooCap} cap) and {R.usage.modelCalls} model calls. We also tried ordering Qloo&apos;s own rooms by popularity and fan affinity together.
      </p>
      <div className={s.stats} data-part="rooms-stats">
        <div className={s.stat}>
          <b>
            {p.shipped.hit1}
            <small> of {p.shipped.cities}</small>
          </b>
          <em className={s.plain}>Cities where the room Routed books is the room the artist really played.</em>
          <span>
            Qloo&apos;s first room: {p.qloo.hit1}. The model&apos;s first guess: {p.model.hit1}. Against Qloo&apos;s first room that is {pts(vsQloo.diff)} pts per artist ({vsQloo.wins}–{vsQloo.losses}–{vsQloo.ties}, {pv(vsQloo.p)}).
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {pts(b1.diff)}
            <small> pts</small>
          </b>
          <em className={s.plain}>
            The booked room is {abs1(b1.diff)} pts {ahead(b1.diff)} the model&apos;s first guess. {sig(b1.p)}.
          </em>
          <span>
            {pc1(b1.meanA)} against {pc1(b1.meanB)} of each artist&apos;s cities ({b1.wins}–{b1.losses}–{b1.ties}, {pv(b1.p)}). In the top 3, Routed&apos;s order is {abs1(b3.diff)} pts {ahead(b3.diff)} ({sig(b3.p).toLowerCase()}, {pv(b3.p)}).
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {pts(pa.diff)}
            <small> pts</small>
          </b>
          <em className={s.plain}>
            Ordering Qloo&apos;s rooms by popularity and affinity together, against affinity alone, in the top 3. {sig(pa.p)}.
          </em>
          <span>
            {p.popAffinity.hit3} cities against {p.qloo.hit3} ({pa.wins}–{pa.losses}–{pa.ties}, {pv(pa.p)}); popularity alone found {p.popular.hit3}.
          </span>
        </div>
      </div>
      <div className={s.reading}>
        <p>
          <b>The agent and the size rule fix most of what Qloo&apos;s room list gets wrong, but not all of it.</b> The room Routed books is the real venue in {p.shipped.hit1} of {p.shipped.cities} cities, against {p.qloo.hit1} for Qloo&apos;s first room, and it still trails the model&apos;s first guess. Of the {src.booked} rooms booked, {src.fromQlooList} came from Qloo&apos;s list, {src.fromAgentNames} from the agent&apos;s names found on Qloo and {src.fromLadder} from the Wikidata ladder. Where the model was right and Routed wasn&apos;t, it was mostly stadium tours (no stadium among the candidates) or a real room the size rule ranked behind another fit. These are 2023–2025 tours the model may have read about, and rooms here were measured without the live service&apos;s stored capacities or web search, so {src.booked - src.measured} booked rooms stayed unmeasured.
        </p>
      </div>
      <ContrastTable
        digits={1}
        rows={[...R.primary, ...R.secondary]}
        caption={`${R.n} artists, ${R.cities} cities. Score per artist: share of their cities where the real venue is the first room (hit@1) or in the first three (hit@3). The first three rows were fixed as primary before the run.`}
      />
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
            {rows.map(([name, x]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>
                  {x.hit1} <span className={s.dim}>of {x.cities}</span>
                </td>
                <td>{x.hit3}</td>
                <td>{x.listed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.history}>
        Protocol: data/outside2/PROTOCOL-4.md, with one amendment made before scoring (11 artists whose Qloo ids had never been cached were found again by one search each). Every city, list and booked room: data/outside2/rooms4.json; written up in <a href={`${REPO}/blob/main/data/outside2/RESULTS.md`} target="_blank" rel="noreferrer">RESULTS.md</a>.
      </p>
    </section>
  );
}
