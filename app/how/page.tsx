import type { Metadata } from "next";
import Link from "next/link";
import { MAX_SHOWS_IN_A_ROW, RADIUS_KM, ROAD_FACTOR, SHOW_DAY_DRIVE_H, TRAVEL_DAY_DRIVE_H, VAN_KMH } from "@/lib/geo/route";
import { loadTour, showcaseTours } from "@/lib/store";
import type { LogLine } from "@/lib/types";
import s from "./how.module.css";

export const metadata: Metadata = { title: "How it works", description: "The agent, every Qloo call it makes, the routing rules, and what Routed doesn't know." };

const CALLS: { match: RegExp; title: string; why: string; endpoint: string }[] = [
  { match: /^Who is/, title: "Find the artist", why: "Resolves the name to a Qloo entity, so every later call is about the right act.", endpoint: "GET /search" },
  { match: /over-index in/, title: "Where the fans are", why: "A heatmap of the region: thousands of map tiles, each with how far this artist's fans over-index there and how much taste signal the tile carries. Routed puts each tile in its city and ranks cities by the two together.", endpoint: "GET /v2/insights with filter.type=urn:heatmap" },
  { match: /by age and gender/, title: "Who the fans are", why: "Signed over- and under-index by age and gender. A young skew means asking rooms for all-ages shows.", endpoint: "GET /v2/insights with filter.type=urn:demographics" },
  { match: /listen to\?/, title: "The sound", why: "Taste analysis restricted to music genres: how to describe the night to a talent buyer.", endpoint: "GET /v2/insights with filter.type=urn:tag and filter.tag.types=urn:tag:genre:music" },
  { match: /describe the music/, title: "The mood", why: "The words this audience's favourite music is tagged with (Sensitive, Dreamy, Anthemic): tone for the poster and the ads.", endpoint: "GET /v2/insights with filter.type=urn:tag and filter.tag.types=urn:tag:artist:qloo" },
  { match: /themes/, title: "The themes", why: "Themes this audience connects with across books, film and music: the creative brief.", endpoint: "GET /v2/insights with filter.type=urn:tag and filter.tag.types=urn:tag:theme:qloo" },
  { match: /dishes/, title: "The food", why: "Dishes these fans seek out at restaurants: a pre-show pop-up partner or the rider.", endpoint: "GET /v2/insights with filter.type=urn:tag and filter.tag.types=urn:tag:specialty_dish:place" },
  { match: /podcasts/, title: "Press", why: "Cross-domain: the podcasts this audience over-indexes on, to pitch first.", endpoint: "GET /v2/insights with filter.type=urn:entity:podcast" },
  { match: /brands/, title: "Merch and partners", why: "Cross-domain: brands these fans over-index on.", endpoint: "GET /v2/insights with filter.type=urn:entity:brand" },
  { match: /films/, title: "Films, TV and books", why: "Cross-domain: what this audience watches and reads, for content and tie-ins.", endpoint: "GET /v2/insights with filter.type=urn:entity:movie, tv_show and book" },
  { match: /growing/, title: "Momentum", why: "Weekly popularity percentile for the last six months; shown when it moved.", endpoint: "GET /v2/trending" },
  { match: /^Which rooms/, title: "Rooms in each city", why: "Places tagged live music venue or concert hall inside the city, ranked by affinity to the artist's fans. Chapels, museums, stores and casinos that carry the tag are left out.", endpoint: "GET /v2/insights with filter.type=urn:entity:place and filter.tags" },
  { match: /^Who could open/, title: "Openers", why: "Artists no bigger than the headliner whose audience matches, weighted to the city's own taste.", endpoint: "GET /v2/insights with filter.type=urn:entity:artist, signal.location.query and filter.popularity.max" },
  { match: /see a poster/, title: "The poster run", why: "Cross-domain: the record stores, bookshops and cafés these fans go to in each city. Chains are left out.", endpoint: "GET /v2/insights with filter.type=urn:entity:place and filter.tags" },
  { match: /go out in/, title: "After the show", why: "Cross-domain again: the bars these fans over-index on in that city.", endpoint: "GET /v2/insights with filter.type=urn:entity:place and filter.tags" },
  { match: /each room, Routed/, title: "Scoring both tours", why: "Every room from Routed's tour and the model-alone tour, scored against this artist's fans in one call restricted to exactly those rooms, so both sides share a scale.", endpoint: "GET /v2/insights with filter.type=urn:entity:place and filter.results.entities" },
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
          NVIDIA Nemotron 3 Ultra (on Nebius Token Factory) works the way a booking agent does, in three moves. It <b>shortlists</b> cities from Qloo&apos;s ranked heatmap, weighing fan strength against geography, with a few alternates. Routed then <b>scouts</b> every shortlisted city through Qloo: the rooms these fans go to and the artists who share the audience. With that evidence the model <b>books</b> one room and one opener per city, swapping in an alternate when a city&apos;s rooms don&apos;t fit, and writes one sentence on why.
        </p>
        <p>
          Rules hold it in. Cities must come from Qloo&apos;s candidates; the radius clause is enforced; the booked room&apos;s capacity is checked on the web, and with a known crowd size a room that misses it is swapped for one that fits; gaps are filled from the ranking. If the model is down or the day&apos;s budget is spent, the same steps run as a fixed plan, and the tour book says which one ran.
        </p>
        <p>
          A free-running tool loop came first. Nemotron repeated lookups and ran out of turns on most tours, so the moves are fixed and the choices are the model&apos;s. Every model call returns strict JSON with reasoning off, which took a booking from about a minute to a few seconds.
        </p>
      </section>

      <section className={s.sec}>
        <h2 className={s.h2}>Use it from your own agent</h2>
        <p>
          Routed is also an MCP server. Add <code>https://routed-tours.vercel.app/api/mcp</code> to any assistant that supports remote MCP servers (Claude, ChatGPT, VS Code) and it gets four tools: <b>fan_map</b> (where an artist&apos;s fans over-index), <b>fan_profile</b> (who they are and what else they love), <b>route_tour</b> (a whole tour in about a minute, with a link to its tour book) and <b>get_tour</b>.
        </p>
      </section>

      <section className={s.sec}>
        <h2 className={s.h2}>The control group</h2>
        <p>
          Every tour also asks the same model, with no Qloo, to route the same shows from what it already knows. Its cities are ranked on the artist&apos;s own heatmap and its rooms are scored in the same Qloo call as Routed&apos;s, so the tour book shows, for that artist, what the taste graph changed. <Link href="/proof">The benchmark</Link> does this for fourteen artists.
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
          <li>Routed sends Qloo only public names: the artist, cities and venues. No personal data is collected or sent.</li>
          <li>Qloo sometimes merges two acts with one name (one &ldquo;Wednesday&rdquo; profile carries Japanese visual-kei tags). Routed takes Qloo&apos;s best match for the name; check the genres on the tour book.</li>
          <li>The comparison scores both tours on Qloo&apos;s own evidence. It shows how much closer the agent gets to where Qloo says the fans are, not ticket sales.</li>
        </ul>
      </section>
    </div>
  );
}
