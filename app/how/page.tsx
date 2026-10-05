import type { Metadata } from "next";
import Link from "next/link";
import { MAX_SHOWS_IN_A_ROW, RADIUS_KM, ROAD_FACTOR, SHOW_DAY_DRIVE_H, TRAVEL_DAY_DRIVE_H, VAN_KMH } from "@/lib/geo/route";
import { loadTour, showcaseTours } from "@/lib/store";
import type { LogLine } from "@/lib/types";
import s from "./how.module.css";

export const metadata: Metadata = { title: "How it works", description: "The agent, every Qloo call it makes, the routing rules, and what Routed doesn't know." };

const CALLS: { match: RegExp; title: string; why: string; endpoint: string }[] = [
  { match: /^Who is/, title: "Find the artist", why: "Resolves the name to a Qloo entity, so every later call is about the right act.", endpoint: "GET /search" },
  { match: /over-index in/, title: "Where the fans are", why: "A heatmap of the region: each tile scores how much this artist's fans over-index there compared with the place's own taste. Routed puts each tile in its city.", endpoint: "GET /v2/insights with filter.type=urn:heatmap" },
  { match: /by age and gender/, title: "Who the fans are", why: "Signed over- and under-index by age and gender. A young skew means asking rooms for all-ages shows.", endpoint: "GET /v2/insights with filter.type=urn:demographics" },
  { match: /else do .* love/, title: "What else they love", why: "Taste analysis: the concepts that describe this audience. Used in pitches and to brief the agent.", endpoint: "GET /v2/insights with filter.type=urn:tag" },
  { match: /growing/, title: "Momentum", why: "Weekly popularity percentile for the last six months.", endpoint: "GET /v2/trending" },
  { match: /brands/, title: "Merch and partners", why: "Cross-domain: brands these fans over-index on.", endpoint: "GET /v2/insights with filter.type=urn:entity:brand" },
  { match: /^Which rooms/, title: "Rooms in each city", why: "Places tagged as music venues inside the city, ranked by affinity to the artist's fans. The agent calls this per city and swaps a city out when its rooms don't fit.", endpoint: "GET /v2/insights with filter.type=urn:entity:place" },
  { match: /^Who could open/, title: "Openers", why: "Artists no bigger than the headliner whose audience matches, weighted to the city's own taste.", endpoint: "GET /v2/insights with filter.type=urn:entity:artist and signal.location" },
  { match: /go out in/, title: "After the show", why: "Cross-domain again: the bars these fans over-index on in that city.", endpoint: "GET /v2/insights with filter.type=urn:entity:place" },
];

async function example(): Promise<{ id: string; artist: string; log: LogLine[] } | null> {
  const id = process.env.SHOWCASE_ID;
  const t = (id ? await loadTour(id).catch(() => null) : null) ?? (await showcaseTours().catch(() => []))[0];
  return t?.status === "done" ? { id: t.id, artist: t.plan?.artist.name ?? t.input.artist, log: t.log } : null;
}

export default async function How() {
  const ex = await example();
  return (
    <div className={`wrap ${s.page}`}>
      <h1 className={s.h1}>How Routed works</h1>
      <p className={s.lede}>
        A booking agent decides where to play from instinct and a streaming dashboard that counts plays, not ticket buyers. Routed asks Qloo&apos;s taste graph instead: where do this
        artist&apos;s fans over-index, which rooms do they already go to, and who shares their audience. An agent turns that into a routed tour, rules check the parts that must be exact,
        and every figure in a pitch is traced to its source.
      </p>

      <section className={s.sec}>
        <h2 className={s.h2}>The agent</h2>
        <p>
          NVIDIA Nemotron 3 Ultra (on Nebius Token Factory) gets the ranked heatmap cities, the fans&apos; age skew and tastes, and three tools: look up rooms in a city, look up openers in a
          city, and finish. It chooses which cities to investigate, calls the tools (several at once), replaces a city whose rooms don&apos;t fit, and submits one room and one opener per stop
          with a one-line reason.
        </p>
        <p>
          Rules hold it in. Cities must come from Qloo&apos;s candidates; the radius clause is enforced; every chosen city gets its room lookup even if the agent skipped it; gaps are filled
          from the ranking. If the model is down or the day&apos;s budget is spent, the same steps run as a fixed plan, and the tour book says which one ran.
        </p>
      </section>

      <section className={s.sec}>
        <h2 className={s.h2}>Every Qloo call{ex ? `, from a real run for ${ex.artist}` : ""}</h2>
        <ol className={s.calls}>
          {CALLS.map((c) => {
            const line = ex?.log.find((l) => l.kind === "qloo" && c.match.test(l.text) && !l.failed);
            return (
              <li key={c.title}>
                <h3>{c.title}</h3>
                <p>{c.why}</p>
                <p className={s.endpoint}>{c.endpoint}</p>
                {line && (
                  <div className={s.example}>
                    <p className={s.q}>{line.text}</p>
                    {line.request && <code>GET {line.request}</code>}
                    {line.result && <p className={s.a}>{line.result}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {ex && (
          <p className={s.note}>
            The full call sheet for that run is at the end of <Link href={`/tour/${ex.id}`}>its tour book</Link>. Requests are shown without the API key.
          </p>
        )}
      </section>

      <section className={s.sec}>
        <h2 className={s.h2}>The rules</h2>
        <ul className={s.rules}>
          <li>Road distance is {ROAD_FACTOR} times the straight line; a van averages {VAN_KMH} km/h.</li>
          <li>
            A show day allows up to {SHOW_DAY_DRIVE_H} hours of driving; longer jumps add travel days of up to {TRAVEL_DAY_DRIVE_H} hours.
          </li>
          <li>After {MAX_SHOWS_IN_A_ROW} shows in a row the band gets a day off.</li>
          <li>No two shows within {RADIUS_KM} km of each other (the radius clause most rooms put in their offers).</li>
          <li>The route is the shortest drive from the starting city: nearest neighbour, then 2-opt until no swap helps.</li>
          <li>Room capacity comes from a web search (Tavily) and is read by rule: a number tied to the word capacity, on a page that names the room. The source is linked.</li>
          <li>A pitch may only use figures from its stop&apos;s evidence. Any other figure is struck through on the page.</li>
        </ul>
      </section>

      <section className={s.sec}>
        <h2 className={s.h2}>What Routed doesn&apos;t know</h2>
        <ul className={s.rules}>
          <li>Qloo affinity says where fans over-index, not how many tickets will sell. It&apos;s the first question a booker asks, not the last.</li>
          <li>Room availability, offers and guarantees come from the rooms. The pitch asks for them.</li>
          <li>Drive times are estimates from distance, not a road router.</li>
          <li>Routed sends Qloo only public names: the artist and the cities. No personal data is collected or sent.</li>
        </ul>
      </section>
    </div>
  );
}
