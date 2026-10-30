import type { Metadata } from "next";
import Link from "next/link";
import { FAN_CAP, FAN_KEEP, MAX_REVISIONS } from "@/lib/agent/plan";
import { SNUG } from "@/lib/agent/evidence";
import { NEAR_VOTE_M } from "@/lib/geo/local";
import { BAR_TAG_DRAW, BIG_ROOM_DRAW, REDUCED_MAX, SHORT_MIN, STADIUM_MIN_DRAW, TWO_NIGHT_MIN } from "@/lib/agent/rooms";
import { ANCHOR_RANK, EXACT_MAX, MAJOR_POP, MAX_LEG_KM, MAX_SHOWS_IN_A_ROW, RADIUS_BY_REGION, ROAD_FACTOR, SHOW_DAY_DRIVE_H, TRAVEL_DAY_DRIVE_H, VAN_KMH } from "@/lib/geo/route";
import { loadTour, showcaseTours } from "@/lib/store";
import type { LogLine, Usage } from "@/lib/types";
import { H2H_ARTISTS } from "@/components/proof/HeadToHead";
import { OUTSIDE2, POST } from "@/components/proof/PostCutoff";
import { AgentLoop } from "./AgentLoop";
import { span, wallStats } from "@/lib/wallstats";
import { SUPPORT_RATIO } from "@/lib/agent/rooms";
import LOOP from "@/data/agent-loop/runs.json";
import s from "./how.module.css";

const pc = (v: number) => `${Math.round(v * 100)}%`;
const n0 = (v: number) => v.toLocaleString("en-US");

export const metadata: Metadata = { title: "How it works", description: "The agent, every Qloo call it makes, the routing rules, and what Routed doesn't know." };
export const revalidate = 600;

const CALLS: { match: RegExp; title: string; why: string; endpoint: string }[] = [
  { match: /^Who is/, title: "Find the artist", why: "Resolves the name to a Qloo entity, so every later call is about the right act.", endpoint: "GET /search" },
  { match: /over-index in/, title: "Where the fans are", why: "A heatmap of the region: thousands of map tiles, each with how far this artist's fans over-index there and how much taste signal the tile carries. Routed puts each tile in its city and ranks cities by the two together.", endpoint: "GET /v2/insights with filter.type=urn:heatmap" },
  { match: /by age and gender/, title: "Who the fans are", why: "Signed over- and under-index by age and gender. A young skew means asking rooms for all-ages shows.", endpoint: "GET /v2/insights with filter.type=urn:demographics" },
  { match: /listen to\?/, title: "The sound", why: "Taste analysis restricted to music genres: how to describe the night to a talent buyer.", endpoint: "GET /v2/insights with filter.type=urn:tag and filter.tag.types=urn:tag:genre:music" },
  { match: /describe the music/, title: "The mood", why: "The words this audience's favourite music is tagged with (Sensitive, Dreamy, Anthemic): tone for the poster and the ads.", endpoint: "GET /v2/insights with filter.type=urn:tag and filter.tag.types=urn:tag:artist:qloo" },
  { match: /podcasts/, title: "Press", why: "Cross-domain: the podcasts this audience over-indexes on, to pitch first.", endpoint: "GET /v2/insights with filter.type=urn:entity:podcast" },
  { match: /brands/, title: "Merch and partners", why: "Cross-domain: brands these fans over-index on.", endpoint: "GET /v2/insights with filter.type=urn:entity:brand" },
  { match: /films/, title: "Films, TV and books", why: "Cross-domain: what this audience watches and reads, for content and tie-ins.", endpoint: "GET /v2/insights with filter.type=urn:entity:movie, tv_show and book" },
  { match: /growing/, title: "Momentum", why: "Weekly popularity percentile for the last six months; shown when it moved.", endpoint: "GET /v2/trending" },
  { match: /^Which (clubs|halls|theatres|arenas)/, title: "Rooms in each city", why: `Places of the kind the crowd needs (clubs and halls; halls, ballrooms and theatres; theatres, amphitheatres and arenas; arenas and amphitheatres), inside the city's radius, ranked by affinity to the artist's fans. For a crowd of ${n0(BIG_ROOM_DRAW)} or more the arenas and amphitheatres are asked for on their own too. Chapels, museums, fairs, housing and parks are never rooms; stadiums only for a crowd of ${n0(STADIUM_MIN_DRAW)} or more; bars, pubs, cafés and restaurants are left out from a crowd of ${n0(BAR_TAG_DRAW)}, and anything named a club from ${n0(BIG_ROOM_DRAW)}.`, endpoint: "GET /v2/insights with filter.type=urn:entity:place, filter.tags, filter.location=POINT(…) and filter.location.radius" },
  { match: /^Who could open/, title: "Support acts", why: "Artists clearly smaller than the headliner whose audience matches, weighted to the city's own taste. A rule rules out the headliner's own members and members of other bands (by Qloo's description), a shared name, and any act with no genre in common. The agent then picks one support act for the whole run.", endpoint: "GET /v2/insights with filter.type=urn:entity:artist, signal.location, filter.popularity.max and .min" },
  { match: /fans share\?$/, title: "What the audiences share", why: "Qloo's audience comparison between the headliner and the support act: the style, genre and mood both fan bases hold, as the words for the pitch. Words every pair shares (Engaging, Passionate) are left out.", endpoint: "GET /v2/analysis/compare with a.signal.interests.entities and b.signal.interests.entities" },
  { match: /street by street/, title: "Inside the city", why: "The heatmap again, for one city: a few hundred tiles about 150 m across say which neighbourhood the fans over-index in. A rule measures the booked room against it, and the poster run is anchored there.", endpoint: "GET /v2/insights with filter.type=urn:heatmap, filter.location=POINT(<city>) and filter.location.radius" },
  { match: /see a poster/, title: "The poster run", why: "Cross-domain: the record stores, bookshops and cafés these fans go to, within 2.5 km of the tile where they over-index most. Chains are left out.", endpoint: "GET /v2/insights with filter.type=urn:entity:place, filter.tags, filter.location=POINT(…) and filter.location.radius" },
  { match: /go out in/, title: "After the show", why: "Cross-domain again: the bars these fans over-index on in that city.", endpoint: "GET /v2/insights with filter.type=urn:entity:place and filter.tags" },
  { match: /each room, Routed/, title: "Scoring both tours", why: "Every room from Routed's tour and the model-alone tour, scored against this artist's fans in one call restricted to exactly those rooms, so both sides share a scale.", endpoint: "GET /v2/insights with filter.type=urn:entity:place and filter.results.entities" },
];

async function example(): Promise<{ id: string; artist: string; log: LogLine[]; usage?: Usage } | null> {
  const id = process.env.SHOWCASE_ID;
  const pinned = id ? await loadTour(id).catch(() => null) : null;
  const t = (pinned?.showcase ? pinned : null) ?? (await showcaseTours().catch(() => []))[0];
  return t?.status === "done" ? { id: t.id, artist: t.plan?.artist.name ?? t.input.artist, log: t.log, usage: t.engine?.usage } : null;
}

export default async function How() {
  const ex = await example();
  const ws = wallStats(await showcaseTours().catch(() => []));
  const typical = ws ? `${span(ws.qloo.min, ws.qloo.max)} Qloo requests (median ${ws.qloo.median}), ${span(ws.model.min, ws.model.max)} model calls and ${span(Math.round(ws.tokens.min / 1000), Math.round(ws.tokens.max / 1000))} thousand tokens each` : undefined;
  // A tour counts as cleared only with fewer objections and no longer worst leg than its first booking's (legWorse).
  const sum = (rows: { before: number; after: number; legWorse?: boolean; scoutCalls?: number }[]) => ({ scout: rows.reduce((n, r) => n + (r.scoutCalls ?? 0), 0), raised: rows.reduce((n, r) => n + r.before, 0), open: rows.reduce((n, r) => n + r.after, 0), cleared: rows.reduce((n, r) => n + (r.legWorse ? 0 : Math.max(0, r.before - r.after)), 0), worse: rows.filter((r) => r.after > r.before || r.legWorse).length, n: rows.length });
  const old = sum(LOOP.oct25.tours);
  const fresh = LOOP.oct30.map((b) => ({ ...b, ...sum(b.tours) }));
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
        <AgentLoop log={ex?.log} usage={ex?.usage} artist={ex?.artist} typical={typical} />
        <p>
          NVIDIA Nemotron 3 Ultra (on Nebius Token Factory) works the way a booking agent does. It <b>shortlists</b> cities from Qloo&apos;s fan cities, weighing fan strength against geography, with a few alternates. It reads them in the order that tested best against real tours, each city&apos;s Qloo fan rank averaged with its rank by population; Qloo&apos;s top {FAN_KEEP} fan cities always stay, and only the top {FAN_CAP} are candidates unless a long leg needs a city to close it. Routed then <b>scouts</b> every shortlisted city through Qloo: the rooms these fans go to and the artists who share the audience. With that evidence the model <b>books</b> one room per city and one support act for the whole run, and writes one sentence on why. Then <b>check_plan</b> runs the tour&apos;s rules over the booking as a tool and sends every objection back; the model <b>re-books</b>, changing only what an objection names, up to {MAX_REVISIONS} times.
        </p>
        <p>
          Rules hold it in, and every rule that changes the agent&apos;s answer says so on the call sheet. What check_plan still objects to after the model&apos;s last answer, a rule settles. Cities must come from Qloo&apos;s candidates; the radius clause is enforced; a major market in the artist&apos;s top ten stays on the tour; no leg between shows runs over {MAX_LEG_KM.toLocaleString("en-US")} km where a city with rooms can close it; rooms are measured and sized to the crowd; one support act plays every date; gaps are filled from the ranking. If the model is down or the day&apos;s budget is spent, the same steps run as a fixed plan, and the tour book says which one ran.
        </p>
        <p>
          A free-running tool loop came first. Nemotron repeated lookups and ran out of turns on most tours, so the moves are fixed and the choices are the model&apos;s. Every model call returns strict JSON with reasoning off, which took a booking from about a minute to a few seconds.
        </p>
      </section>

      <section className={s.sec}>
        <h2 className={s.h2} id="agent-check">Does the agent really re-book?</h2>
        <p>
          Measured, not claimed. On the {old.n} tours of the Oct 25 poster wall as first routed (2 of them since replaced by Oct 30 re-runs), check_plan raised {old.raised} objections to the agent&apos;s first bookings. After two rounds {old.open} were open, some of them new (Alvvays went from 1 to 4), and rules settled them: net of the new ones the agent cleared {old.cleared}, and {old.worse} of the {old.n} tours ended worse than they started, because the last round was kept even when it was worse.
        </p>
        <p>
          On Oct 30 the loop changed: a re-booking replaces the booking only when it leaves fewer objections (a worse one is set aside and the agent is told why), each objection names the cities or swaps that would clear it, and a third round fits in the planning time. Re-runs of poster-wall artists under the new loop, measured the same way:
        </p>
        <table className={s.loopTable}>
          <thead>
            <tr>
              <th scope="col">Loop</th>
              <th scope="col">Tours</th>
              <th scope="col">Objections raised</th>
              <th scope="col">Cleared by the agent itself</th>
              <th scope="col">Open after the last round, settled by rule</th>
              <th scope="col">Tours left worse (more objections or a longer worst leg)</th>
              <th scope="col">scout_city calls</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{LOOP.oct25.label}</td>
              <td>{old.n}</td>
              <td>{old.raised}</td>
              <td>{old.cleared}</td>
              <td>{old.open}</td>
              <td>{old.worse}</td>
              <td>not offered</td>
            </tr>
            {fresh.map((b) => (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td>{b.n}</td>
                <td>{b.raised}</td>
                <td>{b.cleared}</td>
                <td>{b.open}</td>
                <td>{b.worse}</td>
                <td>{/scout_city/.test(b.label) ? b.scout : "not offered"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {fresh.length > 0 && (
          <p>
            With the latest version the agent itself cleared {fresh.at(-1)!.cleared} of the {fresh.at(-1)!.raised} objections on {fresh.at(-1)!.n} re-runs and left {fresh.at(-1)!.worse} worse. What drove it: a round counts only with fewer objections and no longer worst leg, and the 1,800 km leg cap is enforced after the rules settle. scout_city (the agent asking Routed to look up 2 cities of its choice a round) was offered in all three and called in {fresh.at(-1)!.scout} run, whose round then cleared nothing new; the other two cleared everything in their first round without it. The room-grade change landed between these runs, so they don&apos;t isolate one cause. The version before cleared {fresh.length > 1 ? fresh.at(-2)!.cleared : 0} of {fresh.length > 1 ? fresh.at(-2)!.raised : 0}: one of its runs, Sierra Ferrell, went from 3 objections to 1 but ended on a 3,298 km leg, longer than the 1,895 km one first objected to, so it counts as worse, not cleared. Three runs a version is a small sample.
          </p>
        )}
        <p className={s.note}>{LOOP.note}</p>
      </section>

      <section className={s.sec}>
        <h2 className={s.h2} id="mcp">Use it from your own agent</h2>
        <p>
          Routed is also an MCP server. Add <code>https://routed-tours.vercel.app/api/mcp</code> to any assistant that supports remote MCP servers (Claude, ChatGPT, VS Code) and it gets five tools: <b>fan_map</b> (where an artist&apos;s fans over-index), <b>fan_neighbourhoods</b> (where inside one city, with the record stores and cafés there for a poster run), <b>fan_profile</b> (who they are and what else they love), <b>route_tour</b> (a whole tour in about a minute, with a link to its tour book) and <b>get_tour</b>.
        </p>
      </section>

      <section className={s.sec}>
        <h2 className={s.h2}>The control group</h2>
        <p>
          Every tour also asks the same model, with no Qloo, to route the same shows from what it already knows. Its cities are ranked on the artist&apos;s own heatmap and its rooms are scored in the same Qloo call as Routed&apos;s, so the tour book shows, for that artist, what the taste graph changed. <Link href="/proof">The benchmark</Link> does this for twenty artists. Rulers Qloo didn&apos;t make are on the same page: <Link href="/proof#unread">tours announced after the model&apos;s release</Link>, where the city ranking Routed ships beat population for {POST.blendVsPop.wins} of {POST.n} artists, and <Link href="/proof#head-to-head">{H2H_ARTISTS} older real tours</Link>, where the model alone, which may have read them, did better. After every run, the same rules also re-plan the tour on city size alone, with no Qloo or model call, so the tour book names the stops Qloo changed.
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
                    {line.request && (
                      <details>
                        <summary>The request</summary>
                        <code>GET {line.request}</code>
                      </details>
                    )}
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
          <li>
            The radius clause: no two shows closer than {RADIUS_BY_REGION.na} km in North America, {RADIUS_BY_REGION.eu} km in mainland Europe or {RADIUS_BY_REGION.uk} km in the UK and Ireland (where a real tour plays London and Brighton), unless both cities are major markets of {(MAJOR_POP / 1e6).toFixed(1)} million or more (New York and Philadelphia each carry a show).
          </li>
          <li>A major market of {(MAJOR_POP / 1e6).toFixed(1)} million or more in the artist&apos;s top {ANCHOR_RANK} is always on the tour when the route can reach it: no UK tour skips London. The smaller city inside its radius gives way.</li>
          <li>
            No leg over {MAX_LEG_KM.toLocaleString("en-US")} km (ferries and borders counted in hours, at van speed). A tour split across two coasts keeps the group with the artist&apos;s strongest cities and replaces the rest with cities that join it; a long leg left over is broken by a swap. One that no city with rooms can close stays, and its day sheet says so.
          </li>
          <li>The route is the shortest drive from the starting city: every order is searched exactly up to {EXACT_MAX} stops, then 2-opt until no swap helps. Each country&apos;s dates stay together.</li>
          <li>
            Rooms are sized to the usual crowd. Capacities come from Wikidata&apos;s maximum-capacity property (the item must be the room itself, not a hall inside it), then from a web page that names the room, read by rule with the source linked; one number per room, everywhere. A room that holds 60–250% of the crowd is booked for one night, in a booker&apos;s order: a close fit ({pc(SNUG.min)}–{pc(SNUG.max)}) first, then one the fans sell out (60–{pc(SNUG.min)}), then a loose fit ({pc(SNUG.max)}–250%), because selling out a slightly small room beats half-filling a big one. Failing that, one that holds {pc(TWO_NIGHT_MIN)}–60% is booked for two nights, so the two nights hold everyone; then one up to {REDUCED_MAX} times the crowd in a reduced configuration; then a measured room at {pc(SHORT_MIN)}–{pc(TWO_NIGHT_MIN)} for one night, with the sheet saying how short; then a room whose capacity couldn&apos;t be found (the sheet says to ask). A room known to miss by more is booked only when nothing else is left. No stadium below a {STADIUM_MIN_DRAW.toLocaleString("en-US")} crowd.
          </li>
          <li>One support act for the whole run, as on a real tour: never the headliner&apos;s own member or a member of another band, well below the headliner on Qloo&apos;s popularity (at least {SUPPORT_RATIO} times further from the top, so a co-headliner priced like one isn&apos;t booked as support), and sharing a genre with them. The other artists each city suggested are listed as local options.</li>
          <li>A pitch may only use figures from its stop&apos;s evidence; any other figure is struck through on the page. A stop&apos;s one-line reason is held to more: prompt jargon, &ldquo;fits&rdquo; outside {pc(SNUG.min)}–{pc(SNUG.max)} of the crowd, a figure not in the evidence or a match score written as a rank, and the rule&apos;s own sentence replaces it.</li>
          <li>The hold request is written for the talent buyer: the dates and the hold, the routing in and out, the room against the crowd, one line of Qloo evidence and the support act, then the fields an offer needs (ticket price, deal, set lengths, last play in the market, the radius) left for the agent to fill in.</li>
          <li>The fans&apos; neighbourhood is named by a vote of the Qloo places within {NEAR_VOTE_M} m of the city&apos;s hottest heatmap tile, each filed by Qloo under a neighbourhood. A room &ldquo;sits in&rdquo; it only when Qloo files the room under that same name; otherwise the day sheet gives the room&apos;s distance from the hottest blocks. Where Qloo names no neighbourhood, the one OpenStreetMap puts the hottest tile in is named and credited; where neither does, the sheet says so.</li>
          <li>A day sheet says a room &ldquo;fits&rdquo; only when it holds {pc(SNUG.min)}–{pc(SNUG.max)} of the crowd; otherwise it says what the room holds against the crowd.</li>
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
          <li>The tour book&apos;s comparison scores both tours on Qloo&apos;s own evidence. It shows how much closer the agent gets to where Qloo says the fans are, not ticket sales.</li>
          <li>Qloo&apos;s room and support-act rankings are weak predictors of the room and opener a real tour books: on <Link href="/proof#unread">past tours</Link> the model alone found the real venue far more often, and the real opener for {OUTSIDE2.support.pooled.model} of {OUTSIDE2.support.n} tours against Qloo&apos;s {OUTSIDE2.support.pooled.qloo}. Routed measures every room against the crowd before booking it.</li>
        </ul>
      </section>
    </div>
  );
}
