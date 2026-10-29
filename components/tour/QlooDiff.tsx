import type { Plan } from "@/lib/types";
import a from "./agent.module.css";

/**
 * Stops Qloo changed: the same city rules run once on city size alone (no Qloo or model call), set against the
 * tour. Fire is what Qloo's map put on the tour, with the fan rank and size rank behind each; ink is what the
 * biggest cities would have played instead.
 */
export function QlooDiff({ plan }: { plan: Plan }) {
  const d = plan.qlooDiff;
  if (!d) return null;
  const stops = d.kept + d.added.length;
  return (
    <section className={a.diff} aria-labelledby="qloo-diff-title" id="qloo-changed">
      <header className={a.diffHead}>
        <h3 id="qloo-diff-title">Stops Qloo changed</h3>
        <p className={a.diffCount}>
          <b className="num">{d.added.length}</b> of <span className="num">{stops}</span>
        </p>
      </header>
      <p className={a.diffLede}>
        {d.added.length
          ? `The same rules, re-run on city size alone with no Qloo data, would keep ${d.kept} of these cities and swap the rest for bigger ones.`
          : `The same rules, re-run on city size alone with no Qloo data, pick the same ${stops} cities: on this tour Qloo's map and city size agree.`}
      </p>
      {d.added.length > 0 && (
        <div className={a.diffCols}>
          <div className={a.diffAdded}>
            <h4>Qloo put on the tour</h4>
            <ul>
              {d.added.map((x) => (
                <li key={x.marketId}>
                  <b>{x.city}</b>
                  <span>
                    fan <span className="num">#{x.fanRank}</span>, size <span className="num">#{x.popRank}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className={a.diffDropped}>
            <h4>City size alone would play</h4>
            <ul>
              {d.dropped.map((x) => (
                <li key={x.marketId}>
                  <b>{x.city}</b>
                  <span>
                    size <span className="num">#{x.popRank}</span>, {x.fanRank ? (
                      <>
                        fan <span className="num">#{x.fanRank}</span>
                      </>
                    ) : (
                      "no fan signal"
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <p className={a.diffFoot}>Fan rank is the city&apos;s place on {plan.artist.name}&apos;s Qloo heatmap; size rank its place by population among the region&apos;s touring cities.</p>
    </section>
  );
}
