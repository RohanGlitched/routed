import Link from "next/link";
import { RouteForm } from "@/components/home/RouteForm";
import { Poster } from "@/components/poster/Poster";
import { opener, room } from "@/lib/agent/evidence";
import { MARKETS, type RegionId } from "@/lib/geo/markets";
import { posterFor } from "@/lib/poster";
import { loadTour, showcaseTours } from "@/lib/store";
import type { TourRecord } from "@/lib/types";
import s from "./home.module.css";


async function showcase(): Promise<{ hero: TourRecord | null; wall: TourRecord[] }> {
  const wall = await showcaseTours().catch(() => [] as TourRecord[]);
  const pinned = process.env.SHOWCASE_ID ? await loadTour(process.env.SHOWCASE_ID).catch(() => null) : null;
  const hero = pinned?.status === "done" ? pinned : (wall[0] ?? null);
  return { hero, wall: wall.filter((t) => t.plan?.stops?.length) };
}

/** The biggest cities in the region, for the contrast with where the fans actually are. */
function biggest(region: RegionId, n: number) {
  return MARKETS.filter((m) => m.region === region)
    .sort((a, b) => b.pop - a.pop)
    .slice(0, n)
    .map((m) => m.name);
}

export default async function Home({ searchParams }: { searchParams: Promise<{ artist?: string; from?: string }> }) {
  const q = await searchParams;
  const { hero, wall } = await showcase();
  const plan = hero?.plan;
  const poster = plan ? posterFor(plan) : null;
  const stop = plan?.stops?.[1] ?? plan?.stops?.[0];
  const fanCities = plan?.cities?.slice(0, 6) ?? [];
  const big = plan ? biggest(plan.region, 6) : [];

  return (
    <>
      <section className={`wrap ${s.hero}`}>
        <div className={s.pitch}>
          <h1 className={s.h1}>Tour where your fans already are.</h1>
          <p className={s.lede}>
            Name an artist. An agent reads Qloo&apos;s taste graph to find the cities where their fans over-index, the rooms those fans go to and the openers they share, then routes the dates
            and drafts a pitch for every venue.
          </p>
          <RouteForm artist={q.artist ?? hero?.input.artist ?? ""} from={q.from ?? hero?.input.from ?? ""} />
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
                A real route, from live Qloo data: {poster.artist} from {plan!.from.label}, {plan!.stops.length} shows.{" "}
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
              <h3>Pick the rooms and openers</h3>
              <p>
                For each city the agent asks Qloo which music venues these fans already go to, and which smaller artists share the audience. In {stop.city}:
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
              {opener(stop) && <p className={s.small}>Opener: {opener(stop)!.name}</p>}
            </li>
            <li className={s.step}>
              <h3>Route and date it by rule</h3>
              <p>The shortest drive from {plan.from.label.split(",")[0]}, no two shows within 150 km, at most 8 hours behind the wheel on a show day, a day off after five in a row.</p>
              <ul className={s.legs}>
                {plan.stops.slice(0, 5).map((x) => (
                  <li key={x.marketId}>
                    <b>{x.date.slice(5).replace("-", "/")}</b> {x.city}
                    <span>{x.fromKm.toLocaleString("en-US")} km</span>
                  </li>
                ))}
              </ul>
            </li>
            <li className={s.step}>
              <h3>Pitch every room, checked</h3>
              <p>Nemotron drafts a hold request from each stop&apos;s evidence. Every figure in it is checked against that evidence; anything that isn&apos;t there is struck out.</p>
              {stop.pitch && <blockquote className={s.quote}>{stop.pitch.body.split("\n").filter(Boolean).slice(1, 3).join(" ").replace(/~~/g, "")}</blockquote>}
              {room(stop)?.capacity && (
                <p className={s.small}>
                  {room(stop)!.name} holds {room(stop)!.capacity!.value.toLocaleString("en-US")}, per {new URL(room(stop)!.capacity!.source).hostname.replace(/^www\./, "")}.
                </p>
              )}
            </li>
          </ol>
        </section>
      )}

      {wall.length > 0 && (
        <section className={`wrap ${s.wallSec}`} id="wall" aria-labelledby="wall-title">
          <h2 id="wall-title" className={s.h2}>
            Poster wall
          </h2>
          <p className={s.wallLede}>Tours routed on Routed. Each poster is printed from its own run: the dots are that artist&apos;s Qloo heatmap.</p>
          <ul className={s.wall}>
            {wall.map((t) => {
              const p = posterFor(t.plan!);
              if (!p) return null;
              return (
                <li key={t.id}>
                  <Link href={`/tour/${t.id}`} className={s.wallLink}>
                    <Poster {...p} compact />
                    <span>
                      {p.artist}, {t.plan!.stops.length} shows from {t.plan!.from.label.split(",")[0]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
