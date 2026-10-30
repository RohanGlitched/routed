import slRaw from "@/data/outside2/street-level.json";
import { REPO } from "@/lib/headtohead-meta";
import s from "@/app/proof/proof.module.css";

/**
 * Round 6 on /proof: the street level (data/outside2/PROTOCOL-6.md), offline from the stored tours' heatmaps. Every
 * figure is read from data/outside2/street-level.json, so the copy can't drift from the data.
 */

export const PROTOCOL6_COMMIT = "034ad6e";

type C = { name: string; n: number; meanDiff: number; lo: number; hi: number; wins: number; losses: number; ties: number; p: number };
type Row = { artist: string; city: string; venue: string; realKm: number; othersMedianKm: number; centreKm: number; others: number; shareFarther: number };
export type Street = { n: number; candidates: number; usage: { qloo: number; modelCalls: number; fetchCalls: number }; primary: C; secondary: C[]; meanShareFarther: number; inHot: number; tooSmall: boolean; rows: Row[] };
export const STREET = slRaw as unknown as Street;

const pv = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);
const wl = (c: C) => `${c.wins}–${c.losses}–${c.ties}`;
const km = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} km`;
const pc = (v: number) => `${Math.round(v * 100)}%`;

/** The /proof table row for round 6. */
export function streetCheck() {
  const p = STREET.primary;
  return {
    test: "Street level (pilot): the real room vs the city's other rooms, nearer the fans' hottest tile",
    tours: `${STREET.n} rooms`,
    result: `nearer in ${p.wins} of ${p.n}, ${pv(p.p)}; too few to test`,
    wlt: wl(p),
    committed: `Yes, from offline caches (${PROTOCOL6_COMMIT})`,
    href: "#street-level",
  };
}

export function StreetLevel() {
  const S = STREET;
  const p = S.primary;
  const [centre] = S.secondary as [C];
  const artists = new Set(S.rows.map((r) => r.artist)).size;
  const far = [...S.rows].sort((a, b) => b.realKm - a.realKm)[0];
  return (
    <section className={s.sec} aria-labelledby="street-level-title" id="street-level">
      <p className={s.flag}>Protocol committed before scoring, from offline caches</p>
      <h2 id="street-level-title" className={s.h2}>
        The street level: a pilot, too small to test
      </h2>
      <p className={s.lede2}>
        Inside each city, Qloo&apos;s heatmap says which blocks an artist&apos;s fans over-index in, and the day sheet books a room near the hottest one. To check that layer against something Qloo didn&apos;t make, we{" "}
        <a href={`${REPO}/commit/${PROTOCOL6_COMMIT}`} target="_blank" rel="noreferrer">
          committed a protocol
        </a>{" "}
        and placed the rooms artists really played on their own street heatmaps, the ones stored with the poster wall&apos;s tours. Only {S.n} of {S.candidates} real rooms could be placed, from {artists} artists: {S.usage.qloo} Qloo calls, {S.usage.modelCalls} model calls.
      </p>
      <div className={s.stats} data-part="street-stats">
        <div className={s.stat}>
          <b>
            {p.wins} of {p.n}
          </b>
          <em className={s.plain}>Real rooms nearer the hottest tile than the city&apos;s other candidate rooms. Not significant.</em>
          <span>
            {wl(p)}, {pv(p.p)}; mean {km(p.meanDiff)} (95% interval {km(p.lo)} to {km(p.hi)}).
          </span>
        </div>
        <div className={s.stat}>
          <b>{pc(S.meanShareFarther)}</b>
          <em className={s.plain}>Of the other rooms sat farther from the hottest tile than the real room, on average. A room picked at random scores 50%.</em>
          <span>
            {S.inHot} of {S.n} real rooms are in the fans&apos; area as the day sheet defines it.
          </span>
        </div>
        <div className={s.stat}>
          <b>
            {centre.wins} of {centre.n}
          </b>
          <em className={s.plain}>Real rooms nearer the hottest tile than the city centre is. Not significant.</em>
          <span>
            {wl(centre)}, {pv(centre.p)}.{far ? ` The farthest real room, ${far.venue} for ${far.artist}, is ${far.realKm.toFixed(1)} km from the hottest tile.` : ""}
          </span>
        </div>
      </div>
      <div className={s.reading}>
        <p>
          <b>No evidence either way yet.</b> On {S.n} rooms the real one is about as near the fans&apos; hottest tile as a room picked at random from Qloo&apos;s own list for that artist. That is a hard bar, and {S.n} pairs reach significance only at 8–1 or better, so the street layer is a claim this page has not yet tested, not one it has shown.
        </p>
        <p>
          <b>The run that would settle it, sized and not run.</b> The room test&apos;s 34 artists and 102 cities already have the real room and the city&apos;s candidate rooms; each needs one street heatmap, so about 102 Qloo requests and 0 model calls, for 53 to 100 usable cases. It waits for the owner&apos;s OK on Qloo spend.
        </p>
      </div>
      <div className={s.tableWrap}>
        <table className={`${s.table} ${s.narrow}`}>
          <caption className={s.cap}>km from the hottest tile on the artist&apos;s street heatmap for that city. Other rooms: the lower median of the stop&apos;s other candidate rooms.</caption>
          <thead>
            <tr>
              <th scope="col">Artist</th>
              <th scope="col">City</th>
              <th scope="col">Real room</th>
              <th scope="col">Real room, km</th>
              <th scope="col">Other rooms, km</th>
              <th scope="col">City centre, km</th>
              <th scope="col">Rooms farther</th>
            </tr>
          </thead>
          <tbody>
            {S.rows.map((r) => (
              <tr key={`${r.artist}-${r.city}-${r.venue}`}>
                <th scope="row">{r.artist}</th>
                <td>{r.city}</td>
                <td>{r.venue}</td>
                <td>
                  <span className={r.realKm < r.othersMedianKm ? s.best : undefined}>{r.realKm.toFixed(1)}</span>
                </td>
                <td>
                  {r.othersMedianKm.toFixed(1)} <span className={s.dim}>of {r.others}</span>
                </td>
                <td>{r.centreKm.toFixed(1)}</td>
                <td>{pc(r.shareFarther)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.history}>
        Protocol: data/outside2/PROTOCOL-6.md. Numbers: data/outside2/street-level.json, written by scripts/street-level.ts. Written up in{" "}
        <a href={`${REPO}/blob/main/data/outside2/RESULTS.md`} target="_blank" rel="noreferrer">
          RESULTS.md
        </a>
        .
      </p>
    </section>
  );
}
