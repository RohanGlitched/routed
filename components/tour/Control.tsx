import { unrankedLabel } from "@/lib/geo/markets";
import { DOT_R, layoutStrip, type Strip, type StripCity } from "@/lib/rankstrip";
import type { Plan } from "@/lib/types";
import c from "./control.module.css";

const pct = (v?: number) => (v === undefined ? "–" : String(Math.round(v * 100)));
const avg = (v?: number) => (v === undefined ? "–" : `#${Math.round(v)}`);

/**
 * The control group, side by side: the same model routing the same tour with no Qloo, scored on the artist's
 * own Qloo evidence. A rank strip shows where each tour's cities sit on the fan map (left is stronger), then a
 * row per stop compares rooms on the same Qloo affinity call.
 */
export function Control({ plan, agent }: { plan: Plan; agent?: string }) {
  const g = plan.guess;
  if (!g || !g.stops.length) return null;
  const artist = plan.artist.name;
  const n = g.ranked;
  const ours = plan.stops.map((s) => ({ name: s.city, rank: s.score.rank }));
  const theirs = g.stops.filter((s) => s.rank || s.outside).map((s) => ({ name: s.city, rank: s.rank }));
  const missed = plan.stops.filter((s) => !g.stops.some((x) => x.marketId === s.marketId)).sort((a, b) => a.score.rank - b.score.rank);
  const weak = g.stops.filter((x) => !plan.stops.some((s) => s.marketId === x.marketId)).sort((a, b) => (b.rank ?? n + 1) - (a.rank ?? n + 1));
  const better = (g.rankMean.routed ?? 0) < (g.rankMean.guess ?? 0);

  return (
    <section className={c.control} aria-labelledby="control-title">
      <div className={c.head}>
        <h2 id="control-title" className={c.h2}>
          The same model, without Qloo
        </h2>
        <p className={c.lede}>
          Before Routed looked anything up, {agent ?? "the model"} was asked to route the same {plan.stops.length} cities from what it already knows. Its tour was then scored on {artist}&apos;s Qloo evidence, the same way Routed&apos;s was.
        </p>
      </div>

      <div className={c.stats}>
        <div className={`${c.stat} ${c.ours}`}>
          <b>{avg(g.rankMean.routed)}</b>
          <span>Routed&apos;s cities: their average rank among {n} cities on {artist}&apos;s fan map</span>
        </div>
        <div className={c.stat}>
          <b>{avg(g.rankMean.guess)}</b>
          <span>The model alone{g.unscored ? `, with ${g.unscored} stop${g.unscored === 1 ? "" : "s"} outside any touring city (counted last)` : ""}</span>
        </div>
        <div className={c.stat}>
          <b>
            {g.shared}
            <small> of {g.stops.length}</small>
          </b>
          <span>cities both tours chose</span>
        </div>
      </div>

      <figure className={c.strip}>
        <figcaption>Where each tour&apos;s cities rank on {artist}&apos;s fan map. Further left is stronger; the scale is logarithmic, so #1 to #10 takes as much room as #10 to #100.</figcaption>
        <div className={c.stripScroll}>
          <RankStrip ours={ours} theirs={theirs} n={n} />
        </div>
      </figure>

      <div className={c.tables}>
        <TourList
          title="Routed, with Qloo"
          rows={plan.stops.map((s) => {
            const room = s.rooms.find((r) => r.id === s.roomId) ?? s.rooms[0];
            return { city: s.label, rank: s.score.rank, room: room?.name, aff: room ? g.routedRoomAffinity[room.id] ?? room.affinity : undefined };
          })}
          n={n}
          mean={g.roomMean.routed}
          ours
        />
        <TourList title={`${agent ?? "The model"} alone`} rows={g.stops.map((s) => ({ city: s.label, rank: s.rank, room: s.venue, aff: s.venueAffinity, unresolved: !s.venueId }))} n={n} mean={g.roomMean.guess} />
      </div>

      {(missed.length > 0 || weak.length > 0) && (
        <div className={c.diff}>
          {missed.length > 0 && (
            <p>
              <b>Found by Qloo, missed by the model:</b> {missed.map((s) => `${s.city} (#${s.score.rank})`).join(", ")}.
            </p>
          )}
          {weak.length > 0 && (
            <p>
              <b>Chosen by the model instead:</b> {weak.map((s) => `${s.city} (${s.rank ? `#${s.rank}` : s.outside ? unrankedLabel(s, plan.region) : "not placed"})`).join(", ")}.
            </p>
          )}
          {!better && <p>On this tour the model alone did as well on city rank; the difference is in the rooms and the evidence behind each one.</p>}
        </div>
      )}
    </section>
  );
}

function TourList({ title, rows, n, mean, ours = false }: { title: string; rows: { city: string; rank?: number; room?: string; aff?: number; unresolved?: boolean }[]; n: number; mean?: number; ours?: boolean }) {
  return (
    <div className={`${c.list} ${ours ? c.listOurs : ""}`}>
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">City</th>
            <th scope="col">Fan map</th>
            <th scope="col">Room</th>
            <th scope="col">Room match</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.city}</td>
              <td className="num">{r.rank ? `#${r.rank}` : <span className={c.none}>none</span>}</td>
              <td>{r.room ?? "–"}</td>
              <td className="num">{r.aff !== undefined ? pct(r.aff) : <span className={c.none}>{r.unresolved ? "not on Qloo" : "–"}</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Average room match (Qloo affinity, 0–100)</td>
            <td className="num">{pct(mean)}</td>
          </tr>
        </tfoot>
      </table>
      <p className={c.foot}>Fan map: the city&apos;s rank among {n} on the artist&apos;s Qloo heatmap.</p>
    </div>
  );
}

/** Two rows of dots on one log rank axis (lib/rankstrip.ts): Routed in fire, the model alone in blue, the tick labels
 *  under their own baseline. Each dot names its city on hover; the rows label as many cities as fit. */
function RankStrip({ ours, theirs, n }: { ours: StripCity[]; theirs: StripCity[]; n: number }) {
  const st = layoutStrip(ours, theirs, n);
  const [routed, alone] = st.rows as [Strip["rows"][number], Strip["rows"][number]];
  const top = routed.y - 22;
  return (
    <svg viewBox={`0 0 ${st.W} ${st.H}`} className={c.svg} role="img" aria-label={`Routed's cities rank ${ours.map((o) => `#${o.rank}`).join(", ")}; the model alone's rank ${theirs.map((t) => (t.rank ? `#${t.rank}` : "unranked")).join(", ")}.`}>
      {st.ticks.map((t) => (
        <line key={`g${t.label}`} x1={t.x} x2={t.x} y1={top} y2={st.axis.y} stroke="var(--rule)" strokeWidth="1" />
      ))}
      {st.off && <line x1={st.off.x} x2={st.off.x} y1={top} y2={st.axis.y} stroke="var(--rule)" strokeWidth="1" strokeDasharray="3 4" />}
      {st.rows.map((r) => (
        <g key={r.name}>
          <line x1={st.axis.x1} x2={st.off ? st.off.x : st.axis.x2} y1={r.y} y2={r.y} stroke="var(--rule)" strokeWidth="1.5" />
          <text x={0} y={r.y + 5} className={`${c.lane} ${r === routed ? c.laneOurs : c.laneTheirs}`}>
            {r.name}
          </text>
        </g>
      ))}
      <line x1={st.axis.x1} x2={st.axis.x2} y1={st.axis.y} y2={st.axis.y} stroke="var(--ink)" strokeWidth="2" />
      {st.ticks.map((t) => (
        <g key={t.label}>
          <line x1={t.x} x2={t.x} y1={st.axis.y} y2={st.axis.y + 6} stroke="var(--ink)" strokeWidth="1.5" />
          <text x={t.x} y={st.axis.y + 22} textAnchor="middle" className={c.tick}>
            {t.label}
          </text>
        </g>
      ))}
      {st.off && (
        <text x={st.off.x} y={st.axis.y + 22} textAnchor="middle" className={c.tick}>
          {st.off.label}
        </text>
      )}
      {alone.dots.map((d, i) => (
        <g key={`t${i}`}>
          <circle cx={d.x} cy={d.y} r={DOT_R} fill="var(--stock)" stroke="var(--blue)" strokeWidth="2.5">
            <title>{`${d.name}: ${d.rank ? `#${d.rank} on the fan map` : "not a touring city on the fan map"}`}</title>
          </circle>
          {d.label && (
            <>
              {d.label.y2 !== d.label.y1 && Math.abs(d.label.y2 - d.label.y1) > 3 && <line x1={d.x} x2={d.x} y1={d.label.y1} y2={d.label.y2} stroke="var(--blue)" strokeWidth="1" />}
              <text x={d.label.x} y={d.label.y} textAnchor="middle" className={`${c.cityLabel} ${c.cityTheirs}`}>
                {d.label.text}
              </text>
            </>
          )}
        </g>
      ))}
      {routed.dots.map((d, i) => (
        <g key={`o${i}`}>
          <circle cx={d.x} cy={d.y} r={DOT_R} fill="var(--fire)" style={{ mixBlendMode: "multiply" }}>
            <title>{`${d.name}: #${d.rank} on the fan map`}</title>
          </circle>
          {d.label && (
            <>
              {d.label.y2 !== d.label.y1 && Math.abs(d.label.y2 - d.label.y1) > 3 && <line x1={d.x} x2={d.x} y1={d.label.y1} y2={d.label.y2} stroke="var(--fire)" strokeWidth="1" />}
              <text x={d.label.x} y={d.label.y} textAnchor="middle" className={`${c.cityLabel} ${c.cityOurs}`}>
                {d.label.text}
              </text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}
