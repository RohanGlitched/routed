import { AGE_LABEL, AGE_ORDER } from "@/lib/agent/audience";
import type { Plan } from "@/lib/types";
import s from "./tour.module.css";

/** Who the fans are, from Qloo: age skew as a diverging chart, the tastes they share, momentum, and brands. */
export function Audience({ plan }: { plan: Plan }) {
  const a = plan.audience;
  const ages = AGE_ORDER.filter((b) => a.age[b] !== undefined);
  const max = Math.max(0.05, ...ages.map((b) => Math.abs(a.age[b]!)));
  const trend = a.trend.filter((p) => p.percentile !== undefined);
  return (
    <div className={s.audience}>
      {ages.length > 0 && (
        <figure className={s.panel}>
          <figcaption>Fan ages, against the average Qloo user</figcaption>
          <ul className={s.skew} aria-label="Age over- and under-index">
            {ages.map((b) => {
              const v = a.age[b]!;
              return (
                <li key={b}>
                  <span>{AGE_LABEL[b]}</span>
                  <div className={s.track}>
                    <i className={v >= 0 ? s.over : s.under} style={{ width: `${(Math.abs(v) / max) * 50}%` }} />
                  </div>
                  <b className="num">{v > 0 ? "+" : ""}{Math.round(v * 100)}</b>
                </li>
              );
            })}
          </ul>
        </figure>
      )}
      {a.tags.length > 0 && (
        <figure className={s.panel}>
          <figcaption>These fans also love</figcaption>
          <ul className={s.chips}>
            {a.tags.slice(0, 8).map((t) => (
              <li key={t.id}>{t.name}</li>
            ))}
          </ul>
        </figure>
      )}
      {trend.length > 2 && <Trend points={trend as { date: string; percentile: number }[]} />}
      {a.brands.length > 0 && (
        <figure className={s.panel}>
          <figcaption>Brands they over-index on, for merch and partners</figcaption>
          <p className={s.brands}>{a.brands.slice(0, 6).map((b) => b.name).join(", ")}</p>
        </figure>
      )}
    </div>
  );
}

function Trend({ points }: { points: { date: string; percentile: number }[] }) {
  const W = 300, H = 56;
  const vals = points.map((p) => p.percentile);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(1, hi - lo);
  const d = points.map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * W).toFixed(1)},${(H - 4 - ((p.percentile - lo) / span) * (H - 8)).toFixed(1)}`).join(" ");
  const first = vals[0]!, last = vals.at(-1)!;
  return (
    <figure className={s.panel}>
      <figcaption>
        Qloo popularity percentile, last {points.length} weeks: <b className="num">{Math.round(first)}</b> to <b className="num">{Math.round(last)}</b>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className={s.spark} role="img" aria-label={`Popularity percentile went from ${Math.round(first)} to ${Math.round(last)}`}>
        <path d={d} fill="none" stroke="var(--blue)" strokeWidth="2.2" strokeLinejoin="round" />
        <circle cx={W} cy={H - 4 - ((last - lo) / span) * (H - 8)} r="3.5" fill="var(--fire)" />
      </svg>
    </figure>
  );
}
