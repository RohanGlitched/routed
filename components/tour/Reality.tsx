import a from "./agent.module.css";

/**
 * The flagship against the artist's real tour (data/flagship-reality.json, read on the server by
 * app/tour/[id]/reality.ts): which of Routed's cities the artist really played, which the real tour had that Routed
 * didn't, the real rooms' sizes against the usual crowd Routed was given, and the public sources it was read from.
 */
/** The tour the reality check is about, and the deck's "flagship": the tour the live final presents. */
export const FLAGSHIP = "8v4ce57nx6";

export type RealityCheck = {
  artist: string;
  checked: string;
  tour: { name: string; years: string; source: string };
  realCities: { city: string; played: boolean; venue: string; capacity?: number; capacitySource?: string }[];
  routedCities: { city: string; onRealTour: boolean; venue?: string }[];
  summary: string;
  usualCrowd?: { input: number; realMedian?: number; note: string };
  sources: { title: string; url: string }[];
};

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

/** How many of Routed's cities were on the real tour: "5 of 8". */
export function realityCount(r: RealityCheck): { on: number; of: number } {
  return { on: r.routedCities.filter((c) => c.onRealTour).length, of: r.routedCities.length };
}

export function Reality({ data }: { data: RealityCheck }) {
  const { on, of } = realityCount(data);
  const routedKeys = new Set(data.routedCities.map((c) => c.city.toLowerCase()));
  const realOnly = data.realCities.filter((c) => !routedKeys.has(c.city.toLowerCase()));
  return (
    <section className={`${a.diff} ${a.reality}`} aria-labelledby="reality-title" id="reality-check">
      <header className={a.diffHead}>
        <h3 id="reality-title">Reality check</h3>
        <p className={a.diffCount}>
          <b className="num">{on}</b> of <span className="num">{of}</span> on the real tour
        </p>
      </header>
      <p className={a.diffLede}>
        {data.artist}&apos;s{" "}
        <a href={data.tour.source} target="_blank" rel="noreferrer">
          {data.tour.name}
        </a>{" "}
        ({data.tour.years}), from public listings. {data.summary}
      </p>
      <div className={a.diffCols}>
        <div className={a.diffAdded}>
          <h4>Routed&apos;s cities</h4>
          <ul>
            {data.routedCities.map((c) => (
              <li key={c.city}>
                <b>{c.city}</b>
                <span>{c.onRealTour ? `On the real tour${c.venue ? `, ${c.venue}` : ""}` : "Not on the real tour"}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={a.diffDropped}>
          <h4>The real tour{realOnly.length ? `, and ${realOnly.length} ${realOnly.length === 1 ? "city" : "cities"} Routed didn't pick` : ""}</h4>
          <ul>
            {data.realCities.map((c) => (
              <li key={`${c.city}-${c.venue}`}>
                <b>
                  {c.city}
                  {routedKeys.has(c.city.toLowerCase()) ? "" : " (not on Routed's run)"}
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
      {data.usualCrowd && (
        <p className={a.realityCrowd}>
          <b>The usual crowd:</b> Routed was given {n0(data.usualCrowd.input)}
          {data.usualCrowd.realMedian ? `; the real rooms' median is ${n0(data.usualCrowd.realMedian)}` : ""}. {data.usualCrowd.note}
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
