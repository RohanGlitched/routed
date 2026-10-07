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
  const theirs = g.stops.map((s) => ({ name: s.city, rank: s.rank }));
  const cap = Math.min(n, Math.max(40, ...ours.map((o) => o.rank), ...theirs.map((t) => t.rank ?? 0)) + 4);
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
          Before Routed looked anything up, {agent ?? "the model"} was asked to route the same {plan.stops.length} shows from what it already knows. Its tour was then scored on {artist}&apos;s Qloo evidence, the same way Routed&apos;s was.
        </p>
      </div>

      <div className={c.stats}>
        <div className={`${c.stat} ${c.ours}`}>
          <b>{avg(g.rankMean.routed)}</b>
          <span>Routed&apos;s cities: their average rank among {n} cities on {artist}&apos;s fan map</span>
        </div>
        <div className={c.stat}>
          <b>{avg(g.rankMean.guess)}</b>
          <span>The model alone{g.unscored ? `, with ${g.unscored} cit${g.unscored === 1 ? "y" : "ies"} where Qloo found no fans at all` : ""}</span>
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
        <figcaption>Where each tour&apos;s cities rank on {artist}&apos;s fan map. Further left is stronger.</figcaption>
        <RankStrip ours={ours} theirs={theirs} cap={cap} />
        <div className={c.legend} aria-hidden="true">
          <span className={c.keyOurs}>Routed</span>
          <span className={c.keyTheirs}>Model alone</span>
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
              <b>Chosen by the model instead:</b> {weak.map((s) => `${s.city} (${s.rank ? `#${s.rank}` : "no fan signal"})`).join(", ")}.
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

/** Two rows of marks on one rank axis: Routed above in fire, the model alone below in ink. */
function RankStrip({ ours, theirs, cap }: { ours: { name: string; rank: number }[]; theirs: { name: string; rank?: number }[]; cap: number }) {
  const W = 760, H = 112, L = 12, R = 12;
  const x = (rank: number) => L + ((Math.min(rank, cap) - 1) / Math.max(1, cap - 1)) * (W - L - R);
  // Leave room for the end label: no tick within 50 px of it.
  const ticks = [1, 10, 20, 30, 40, 50, 75, 100, 150, 200].filter((t) => t <= cap && x(cap) - x(t) > 50);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={c.svg} role="img" aria-label={`Routed's cities rank ${ours.map((o) => `#${o.rank}`).join(", ")}; the model alone's rank ${theirs.map((t) => (t.rank ? `#${t.rank}` : "unranked")).join(", ")}.`}>
      <line x1={L} x2={W - R} y1={56} y2={56} stroke="var(--ink)" strokeWidth="2" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={51} y2={61} stroke="var(--ink)" strokeWidth="1.5" />
          <text x={x(t)} y={78} textAnchor="middle" className={c.tick}>
            #{t}
          </text>
        </g>
      ))}
      <text x={W - R} y={78} textAnchor="end" className={c.tick}>
        {cap < 200 ? `#${cap}+` : ""}
      </text>
      {ours.map((o, i) => (
        <g key={`o${i}`}>
          <line x1={x(o.rank)} x2={x(o.rank)} y1={22} y2={52} stroke="var(--fire)" strokeWidth="2.5" />
          <circle cx={x(o.rank)} cy={20} r={6.5} fill="var(--fire)" style={{ mixBlendMode: "multiply" }}>
            <title>{`${o.name}: #${o.rank}`}</title>
          </circle>
        </g>
      ))}
      {theirs.map((t, i) => (
        <g key={`t${i}`}>
          <line x1={x(t.rank ?? cap)} x2={x(t.rank ?? cap)} y1={60} y2={90} stroke="var(--blue)" strokeWidth="2.5" />
          <circle cx={x(t.rank ?? cap)} cy={93} r={6.5} fill="var(--stock)" stroke="var(--blue)" strokeWidth="2.5">
            <title>{`${t.name}: ${t.rank ? `#${t.rank}` : "no fan signal"}`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}
