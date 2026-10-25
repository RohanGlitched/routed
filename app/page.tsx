import { unrankedLabel } from "@/lib/geo/markets";
import Link from "next/link";
import { Suspense } from "react";
import { PrefilledForm } from "@/components/home/PrefilledForm";
import { RouteForm } from "@/components/home/RouteForm";
import { StickyRoute } from "@/components/home/StickyRoute";
import { Wall } from "@/components/home/Wall";
import { Poster } from "@/components/poster/Poster";
import { opener, room } from "@/lib/agent/evidence";
import { MARKETS, type RegionId } from "@/lib/geo/markets";
import { independents } from "@/lib/chains";
import { posterFor } from "@/lib/poster";
import { homeData } from "@/lib/showcase";
import { POST } from "@/components/proof/PostCutoff";
import s from "./home.module.css";

/**
 * The home page is built from cached reads (lib/showcase.ts) and rebuilt every two minutes, not on every visit:
 * the CDN serves it in between. Only the hero poster is drawn in the page; the wall's posters are drawn in the
 * browser as they scroll near (components/home/Wall.tsx).
 */
export const revalidate = 120;

/** The biggest cities in the region, for the contrast with where the fans actually are. */
function biggest(region: RegionId, n: number) {
  return MARKETS.filter((m) => m.region === region)
    .sort((a, b) => b.pop - a.pop)
    .slice(0, n)
    .map((m) => m.name);
}

/** The pitch's strongest sentence or two for the home page: the longest paragraph, struck figures removed. */
function pitchLine(body: string): string {
  const para =
    body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^(hi|hello|thanks)\b/i.test(l))
      .sort((a, b) => b.length - a.length)[0] ?? "";
  const clean = para.replace(/~~[^~]+~~/g, "").replace(/\s+/g, " ");
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  return sentences.slice(0, 2).join(" ").trim();
}

/** "8 cities (12 shows)" when two-night stands add shows, else "8 shows": one convention for every count. */
function showCount(stops: { nights?: number }[]): string {
  const shows = stops.reduce((n, x) => n + (x.nights ?? 1), 0);
  return shows > stops.length ? `${stops.length} cities (${shows} shows)` : `${shows} shows`;
}

export default async function Home() {
  const { hero, wall, bench: b } = await homeData().catch(() => ({ hero: null, wall: [], bench: null }));
  const plan = hero?.plan;
  const poster = plan ? posterFor(plan) : null;
  const stop = plan?.stops?.[1] ?? plan?.stops?.[0];
  const fanCities = plan?.cities?.slice(0, 6) ?? [];
  const big = plan ? biggest(plan.region, 6) : [];
  // Films, TV and books this audience over-indexes on (Qloo cross-domain), one of each first, as on the tour page.
  const media = plan?.audience?.media;
  const watch = [media?.films?.[0], media?.tv?.[0], media?.books?.[0], media?.films?.[1]].filter((x) => x?.name).slice(0, 3).map((x) => x!.name);

  return (
    <>
      <section className={`wrap ${s.hero}`}>
        <div className={s.pitch}>
          <h1 className={s.h1}>Tour where the fans are dense, not where the cities are big.</h1>
          <Suspense fallback={<RouteForm artist={hero?.input.artist ?? ""} from={hero?.input.from ?? ""} />}>
            <PrefilledForm artist={hero?.input.artist ?? ""} from={hero?.input.from ?? ""} />
          </Suspense>
          <p className={s.lede}>
            Which city, which neighbourhood, which room. Name an artist and an agent reads Qloo&apos;s taste graph for the cities where their fans over-index, the blocks inside each city where they live and the rooms they go to, sized to the crowd. It picks one support act for the run, routes and dates the shows, and drafts a checked pitch for each venue. On {POST.n} tours announced after the model&apos;s release, the city ranking Routed ships found{" "}
            <Link href="/proof#unread">{(POST.blendVsPop.diff * 100).toFixed(1)} pts more of the real cities</Link> than a big-city list.
          </p>
          <StickyRoute />
        </div>
        <figure className={s.stage}>
          {poster && hero ? (
            <>
              <Link href={`/tour/${hero.id}`} className={s.posterLink} aria-label={`Open the ${poster.artist} tour book`}>
                <div className={s.posterTilt}>
                  <Poster {...poster} print />
                </div>
              </Link>
              <figcaption className={s.caption}>
                A real route, from live Qloo data: {poster.artist} from {plan!.from.label}, {showCount(plan!.stops)}.{" "}
                <Link href={`/tour/${hero.id}`}>Open the tour book</Link>
              </figcaption>
            </>
          ) : (
            <div className={s.blank} aria-hidden="true">
              <span>Your poster prints here</span>
            </div>
          )}
        </figure>
      </section>

      {plan && stop && (
        <section className={`wrap ${s.how}`} aria-labelledby="how-title">
          <h2 id="how-title" className={s.h2}>
            How a route is made
          </h2>
          <ol className={s.steps}>
            <li className={s.step}>
              <h3>Find where the fans over-index</h3>
              <p>Qloo&apos;s heatmap shows where {plan.artist.name} fans are denser than the taste of the place would predict. That is rarely the list of biggest cities.</p>
              <div className={s.versus}>
                <div>
                  <h4>Biggest cities</h4>
                  <ol>
                    {big.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ol>
                </div>
                <div>
                  <h4>{plan.artist.name} fan cities</h4>
                  <ol className={s.fan}>
                    {fanCities.map((c) => (
                      <li key={c.marketId}>
                        {c.name} <span>{Math.round(c.affinity * 100)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </li>
            <li className={s.step}>
              <h3>Pick the rooms and the support act</h3>
              <p>
                For each city the agent asks Qloo which music venues these fans already go to, and which smaller artists share the audience; one of them supports every date. In {stop.city}:
              </p>
              <ul className={s.bars}>
                {stop.rooms.slice(0, 3).map((r) => (
                  <li key={r.id} className={r.id === stop.roomId ? s.picked : undefined}>
                    <span>{r.name}</span>
                    <i style={{ width: `${Math.round((r.affinity ?? 0) * 100)}%` }} />
                    <b>{Math.round((r.affinity ?? 0) * 100)}</b>
                  </li>
                ))}
              </ul>
              {opener(stop) && <p className={s.small}>Support on every date: {opener(stop)!.name}</p>}
            </li>
            <li className={s.step}>
              <h3>Route and date it by rule</h3>
              <p>The shortest drive from {plan.from.label.split(",")[0]}, no two shows within 150 km, at most 8 hours behind the wheel on a show day, a day off after five in a row.</p>
              <ul className={s.legs}>
                {plan.stops.slice(0, 5).map((x, i) => (
                  <li key={x.marketId}>
                    <b>{x.date.slice(5).replace("-", "/")}</b> {x.city}
                    <span>{i === 0 ? "Opening night" : `${x.fromKm.toLocaleString("en-US")} km`}</span>
                  </li>
                ))}
              </ul>
            </li>
            <li className={s.step}>
              <h3>Pitch every room, checked</h3>
              <p>Nemotron drafts a hold request from each stop&apos;s evidence. Every figure in it is checked against that evidence; anything that isn&apos;t there is struck out.</p>
              {stop.pitch && <blockquote className={s.quote}>{pitchLine(stop.pitch.body)}</blockquote>}
              {room(stop)?.capacity && (
                <p className={s.small}>
                  {room(stop)!.name} holds {room(stop)!.capacity!.value.toLocaleString("en-US")}, per {new URL(room(stop)!.capacity!.source).hostname.replace(/^www\./, "")}.
                </p>
              )}
            </li>
          </ol>
        </section>
      )}

      {plan?.guess && (
        <section className={`wrap ${s.versusSec}`} aria-labelledby="versus-title">
          <div className={s.versusHead}>
            <h2 id="versus-title" className={s.h2}>
              The same model, without Qloo
            </h2>
            <p className={s.versusLede}>
              Every tour runs twice. Before the agent looks anything up, the same model routes the same shows from what it already knows, and both tours are scored on the artist&apos;s own Qloo evidence.
            </p>
          </div>
          <div className={s.duel}>
            <div className={s.duelSide}>
              <h3>{plan.artist.name}, model alone</h3>
              <ol>
                {plan.guess.stops.map((g, i) => (
                  <li key={i} className={g.rank && g.rank <= 25 ? undefined : s.cold}>
                    <span>{g.city}</span>
                    <b>{g.rank ? `#${g.rank}` : g.outside ? unrankedLabel(g, plan.region) : "not placed"}</b>
                  </li>
                ))}
              </ol>
              <p>
                Average rank <b>#{Math.round(plan.guess.rankMean.guess ?? 0)}</b> of {plan.guess.ranked}
              </p>
            </div>
            <div className={`${s.duelSide} ${s.duelOurs}`}>
              <h3>{plan.artist.name}, with Qloo</h3>
              <ol>
                {plan.stops.map((x) => (
                  <li key={x.marketId}>
                    <span>{x.city}</span>
                    <b>#{x.score.rank}</b>
                  </li>
                ))}
              </ol>
              <p>
                Average rank <b>#{Math.round(plan.guess.rankMean.routed ?? 0)}</b> of {plan.guess.ranked}
              </p>
            </div>
            <div className={s.duelNote}>
              {b ? (
                <p>
                  Across <b>{b.n}</b> artists in the benchmark, Routed&apos;s cities averaged <b>#{Math.round(b.routed)}</b> on each artist&apos;s Qloo fan map, the same model alone <b>#{Math.round(b.guess)}</b>. That is Qloo&apos;s own ruler; on real tours announced after the model&apos;s release, Qloo + population beat population for {POST.blendVsPop.wins} of {POST.n} artists.
                </p>
              ) : (
                <p>Cities in grey sit outside the artist&apos;s top 25 on Qloo&apos;s heatmap.</p>
              )}
              <Link href="/proof" className={s.more}>
                See every artist
              </Link>
            </div>
          </div>
        </section>
      )}

      {plan?.audience?.media?.podcasts?.length ? (
        <section className={`wrap ${s.beyond}`} aria-labelledby="beyond-title">
          <h2 id="beyond-title" className={s.h2}>
            Beyond the room
          </h2>
          <p className={s.versusLede}>The same audience across the rest of Qloo&apos;s graph becomes the work around a tour. For {plan.artist.name}:</p>
          <dl className={s.beyondList}>
            <div>
              <dt>Approach these brands</dt>
              <dd>{plan.audience.brands.slice(0, 3).map((x) => x.name).join(", ")}</dd>
            </div>
            {plan.audience.media?.podcasts?.length ? (
              <div>
                <dt>Pitch these podcasts</dt>
                <dd>{plan.audience.media.podcasts.slice(0, 3).map((x) => x.name).join(", ")}</dd>
              </div>
            ) : null}
            {independents(plan.stops[0]?.posters).length ? (
              <div>
                <dt>Poster run in {plan.stops[0].city}</dt>
                <dd>{independents(plan.stops[0]!.posters).slice(0, 3).map((x) => x.name).join(", ")}</dd>
              </div>
            ) : null}
            {watch.length ? (
              <div>
                <dt>Watch and read</dt>
                <dd>{watch.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {wall.length > 0 && (
        <section className={`wrap ${s.wallSec}`} id="wall" aria-labelledby="wall-title">
          <h2 id="wall-title" className={s.h2}>
            Poster wall
          </h2>
          <p className={s.wallLede}>Tours routed on Routed. Each poster is printed from its own run: the dots are that artist&apos;s Qloo heatmap.</p>
          <Wall items={wall.map(({ id, artist, shows, from }) => ({ id, artist, shows, from }))} />
        </section>
      )}
    </>
  );
}
