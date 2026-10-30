import type { QlooDiff } from "@/lib/types";
import { FLAGSHIP, playedCount, realityCount, realityLead, realityMatches, realityMisses, type RealityCheck } from "./realityFacts";
import a from "./agent.module.css";

/**
 * The flagship against the artist's real tours (data/flagship-reality.json, read on the server by
 * app/tour/[id]/reality.ts): which of Routed's cities the artist really played, on the headline tour or before it,
 * which the real tour had that Routed didn't, the real rooms' sizes against the usual crowd Routed was given, and
 * the public sources it was read from. The counting is in realityFacts.ts.
 */
export { FLAGSHIP, realityCount, type RealityCheck };

const n0 = (v: number) => v.toLocaleString("en-US");
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
/** "Oct 30, 2026", in UTC on the server and the browser alike. */
const checkedOn = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function Reality({ data, diff, stops }: { data: RealityCheck; diff?: QlooDiff; stops?: { city: string; score: { rank: number } }[] }) {
  const { on, of } = realityCount(data);
  const played = playedCount(data);
  const lead = realityLead(data, diff, stops);
  const misses = realityMisses(data);
  const matches = realityMatches(data);
  const realOnly = matches.filter((m) => !m).length;
  const headline = data.routedCities.filter((c) => c.onRealTour).map((c) => c.city);
  // "Nashville (2026, support)": the other markets she played, each with its year.
  const earlier = data.routedCities.filter((c) => !c.onRealTour && c.played).map((c) => `${c.city} (${c.played!.year}${c.played!.note && /support|opening/i.test(c.played!.note) ? ", support" : ""})`);
  const crowd = data.usualCrowd;
  return (
    <section className={`${a.diff} ${a.reality}`} aria-labelledby="reality-title" id="reality-check">
      <header className={a.diffHead}>
        <h3 id="reality-title">Reality check</h3>
        <div className={a.realityNums}>
          <p className={a.diffCount}>
            <b className="num">{played.played}</b> of <span className="num">{played.of}</span> are markets she played in {played.years}
          </p>
          <p className={a.diffCount}>
            <b className="num">{on}</b> of <span className="num">{of}</span> on the {data.tour.years} headline dates
          </p>
          {crowd?.realMedian ? (
            <p className={a.realityScale}>
              Her {data.tour.years} rooms median <span className="num">{n0(crowd.realMedian)}</span>; this run is sized for a <span className="num">{n0(crowd.input)}</span> crowd.
            </p>
          ) : null}
        </div>
      </header>
      <div className={a.realityLines}>
        {lead && (
          <p className={a.realityLead}>
            {lead.text} ({lead.city}).
          </p>
        )}
        <p>
          {headline.length ? (
            <>
              {list(headline)} {headline.length === 1 ? "is" : "are"} on {data.artist}&apos;s{" "}
              <a href={data.tour.source} target="_blank" rel="noreferrer">
                {data.tour.name}
              </a>{" "}
              ({data.tour.years}).
            </>
          ) : (
            <>None of these cities is on {data.artist}&apos;s {data.tour.name}.</>
          )}{" "}
          {earlier.length ? `${earlier.length} more ${earlier.length === 1 ? "is a market" : "are markets"} she played in ${played.years}: ${list(earlier)}.` : ""}
        </p>
        <p>
          {misses.length ? `${list(misses)} ${misses.length === 1 ? "is" : "are"} on none of the ${played.years} listings read. ` : ""}A model may also know her past tours, so the overlap shows fit, not foresight.
        </p>
      </div>
      <div className={a.diffCols}>
        <div className={a.diffAdded}>
          <h4>Routed&apos;s cities</h4>
          <ul>
            {data.routedCities.map((c) => (
              <li key={c.city}>
                <b>{c.city}</b>
                <span>
                  {c.onRealTour ? (
                    `On the ${data.tour.years} tour${c.venue ? `, ${c.venue}` : ""}`
                  ) : c.played ? (
                    <>
                      Played {c.played.year}, {c.played.venue}
                      {c.played.note ? `, ${c.played.note}` : ""} (
                      <a href={c.played.source} target="_blank" rel="noreferrer">
                        {host(c.played.source)}
                      </a>
                      )
                    </>
                  ) : (
                    `Not on the ${played.years} listings read`
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={a.diffDropped}>
          <h4>
            The {data.tour.years} tour{realOnly ? `, and ${realOnly} ${realOnly === 1 ? "city" : "cities"} Routed didn't pick` : ""}
          </h4>
          <ul>
            {data.realCities.map((c, i) => (
              <li key={`${c.city}-${c.venue}`}>
                <b>
                  {c.city}
                  {matches[i] ? ` (Routed's ${matches[i]})` : " (not on Routed's run)"}
                </b>
                <span>
                  {c.venue}
                  {c.capacity ? (
                    <>
                      , holds {n0(c.capacity)}
                      {c.capacitySource ? (
                        <>
                          {" "}
                          (
                          <a href={c.capacitySource} target="_blank" rel="noreferrer">
                            {host(c.capacitySource)}
                          </a>
                          )
                        </>
                      ) : null}
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {crowd && (
        <p className={a.realityCrowd}>
          <b>The usual crowd:</b> Routed was given {n0(crowd.input)}
          {crowd.realMedian ? `; the real rooms' median is ${n0(crowd.realMedian)}` : ""}. {crowd.note}
        </p>
      )}
      {data.sources.length > 0 && (
        <p className={a.diffFoot}>
          Checked {checkedOn(data.checked)}. Sources:{" "}
          {data.sources.map((x, i) => (
            <span key={x.url}>
              {i > 0 && ", "}
              <a href={x.url} target="_blank" rel="noreferrer">
                {x.title}
              </a>
            </span>
          ))}
          .
        </p>
      )}
    </section>
  );
}
