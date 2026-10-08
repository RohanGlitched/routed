import type { Metadata } from "next";
import Link from "next/link";
import { CONTROL_PROMPT } from "@/lib/agent/guess";
import { findMarket, marketId } from "@/lib/geo/markets";
import { shelfTours } from "@/lib/store";
import type { TourRecord } from "@/lib/types";
import s from "./proof.module.css";

export const metadata: Metadata = {
  title: "With and without Qloo",
  description: "The same model routed the same tours with and without Qloo's taste graph. Here is what changed, artist by artist.",
};
export const revalidate = 300;

type Row = {
  id: string;
  artist: string;
  from: string;
  ranked: number;
  routed: number;
  guess: number;
  shared: number;
  shows: number;
  roomRouted?: number;
  roomGuess?: number;
  /** Rank of the artist's home city on their own heatmap: an outside check that the map reflects the world. */
  home?: number;
  /** The guessed city ranked lowest, and the strongest city the model missed. */
  worst?: { city: string; rank?: number };
  missed?: { city: string; rank: number };
  outside: number;
};

function rows(tours: TourRecord[]): Row[] {
  return tours
    .filter((t) => t.plan?.guess?.stops.length)
    .map((t) => {
      const p = t.plan!;
      const g = p.guess!;
      const home = findMarket(t.input.from);
      const homeScore = home ? p.cities.find((c) => c.marketId === marketId(home)) : undefined;
      const theirs = g.stops.filter((x) => !p.stops.some((s) => s.marketId === x.marketId));
      const worst = [...theirs].sort((a, b) => (b.rank ?? 1e9) - (a.rank ?? 1e9))[0];
      const missed = p.stops.filter((s) => !g.stops.some((x) => x.marketId === s.marketId)).sort((a, b) => a.score.rank - b.score.rank)[0];
      return {
        id: t.id,
        artist: p.artist.name,
        from: t.input.from,
        ranked: g.ranked,
        routed: g.rankMean.routed ?? 0,
        guess: g.rankMean.guess ?? 0,
        shared: g.shared,
        shows: g.stops.length,
        roomRouted: g.roomMean.routed,
        roomGuess: g.roomMean.guess,
        home: homeScore?.rank,
        worst: worst ? { city: worst.city, rank: worst.rank } : undefined,
        missed: missed ? { city: missed.city, rank: missed.score.rank } : undefined,
        outside: g.stops.filter((x) => !x.rank || x.rank > 25).length,
      };
    })
    .sort((a, b) => b.guess - b.routed - (a.guess - a.routed));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export default async function Proof() {
  const tours = await shelfTours("bench").catch(() => [] as TourRecord[]);
  const r = rows(tours);
  const shows = r.reduce((n, x) => n + x.shows, 0);
  const outside = r.reduce((n, x) => n + x.outside, 0);
  const routedOutside = tours.reduce((n, t) => n + (t.plan?.stops.filter((s) => s.score.rank > 25).length ?? 0), 0);
  const homes = r.filter((x) => x.home !== undefined);
  const cap = Math.max(40, ...r.map((x) => Math.ceil(x.guess / 10) * 10));
  const close = r.filter((x) => x.guess - x.routed < 2);
  // Every stop pooled: the median rank (one #204 can't pull it) and how many stops sat in the artist's top ten.
  const ranksRouted = tours.flatMap((t) => t.plan?.stops.map((s) => s.score.rank) ?? []);
  const ranksGuess = tours.flatMap((t) => t.plan?.guess?.stops.filter((x) => x.rank || x.outside).map((x) => x.rank ?? (t.plan?.cities.length ?? 0) + 1) ?? []);
  const median = (xs: number[]) => {
    const v = [...xs].sort((a, b) => a - b);
    return v.length ? (v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2) : 0;
  };
  const top10 = (xs: number[]) => (xs.length ? Math.round((100 * xs.filter((x) => x <= 10).length) / xs.length) : 0);

  return (
    <div className={`wrap ${s.page}`}>
      <header className={s.head}>
        <h1 className={s.h1}>With and without Qloo</h1>
        <p className={s.lede}>
          Every tour on Routed runs twice. Before the agent looks anything up, the same model is asked to route the same shows from what it already knows. Both tours are then scored on the artist&apos;s own Qloo evidence. Here are {r.length || "the"} artists, run on the live site.
        </p>
      </header>

      {r.length === 0 ? (
        <p className={s.empty}>The benchmark hasn&apos;t run on this deployment yet.</p>
      ) : (
        <>
          <section className={s.stats} aria-label="Totals">
            <div className={`${s.stat} ${s.fire}`}>
              <b>#{Math.round(mean(r.map((x) => x.routed)))}</b>
              <span>Average rank of Routed&apos;s cities on each artist&apos;s fan map (median stop #{median(ranksRouted)}; {top10(ranksRouted)}% of stops in the artist&apos;s top ten)</span>
            </div>
            <div className={s.stat}>
              <b>#{Math.round(mean(r.map((x) => x.guess)))}</b>
              <span>The same model alone, on the same tours (median stop #{median(ranksGuess)}; {top10(ranksGuess)}% in the top ten)</span>
            </div>
            <div className={s.stat}>
              <b>
                {outside}
                <small> of {shows}</small>
              </b>
              <span>
                cities the model alone chose outside the artist&apos;s top 25 (Routed: {routedOutside})
              </span>
            </div>
          </section>

          <section className={s.sec} aria-labelledby="by-artist">
            <h2 id="by-artist" className={s.h2}>
              Artist by artist
            </h2>
            <p className={s.note}>Average rank of each tour&apos;s cities among every city where Qloo found fans. Left is stronger.</p>
            {close.length > 0 && (
              <p className={s.close}>
                The gap closes where touring cities are few and the biggest ones are also where the fans are: for {close.map((x) => x.artist).join(", ")}, the model alone did about as well or better. Qloo earns its keep where an artist&apos;s audience doesn&apos;t follow the population.
              </p>
            )}
            <ul className={s.dumbbells}>
              {r.map((x) => (
                <li key={x.id}>
                  <Link href={`/tour/${x.id}`} className={s.name}>
                    {x.artist}
                  </Link>
                  <svg viewBox="0 0 600 28" className={s.bell} role="img" aria-label={`${x.artist}: Routed averaged #${x.routed.toFixed(1)}, the model alone #${x.guess.toFixed(1)}`}>
                    <line x1="0" x2="600" y1="14" y2="14" stroke="var(--rule)" strokeWidth="1" />
                    <line x1={pos(x.routed, cap)} x2={pos(x.guess, cap)} y1="14" y2="14" stroke="var(--ink)" strokeWidth="2" />
                    <circle cx={pos(x.guess, cap)} cy="14" r="7" fill="var(--stock)" stroke="var(--blue)" strokeWidth="2.5" />
                    <circle cx={pos(x.routed, cap)} cy="14" r="7" fill="var(--fire)" />
                  </svg>
                  <span className={s.nums}>
                    <b>#{x.routed.toFixed(1)}</b> vs #{x.guess.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
            <div className={s.axis} aria-hidden="true">
              <div>
                <span>#1</span>
                <span>#{Math.round(cap / 2)}</span>
                <span>#{cap}+</span>
              </div>
            </div>
            <div className={s.legend} aria-hidden="true">
              <span className={s.keyFire}>Routed</span>
              <span className={s.keyBlue}>Model alone</span>
            </div>
          </section>

          <section className={s.sec} aria-labelledby="table-title">
            <h2 id="table-title" className={s.h2}>
              The runs
            </h2>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">Artist</th>
                    <th scope="col">Cities ranked</th>
                    <th scope="col">Routed</th>
                    <th scope="col">Model alone</th>
                    <th scope="col">Shared</th>
                    <th scope="col">Room match, Routed / alone</th>
                    <th scope="col">Strongest city the model missed</th>
                    <th scope="col">Weakest city it chose</th>
                  </tr>
                </thead>
                <tbody>
                  {r.map((x) => (
                    <tr key={x.id}>
                      <th scope="row">
                        <Link href={`/tour/${x.id}`}>{x.artist}</Link>
                      </th>
                      <td>{x.ranked}</td>
                      <td>#{x.routed.toFixed(1)}</td>
                      <td>#{x.guess.toFixed(1)}</td>
                      <td>
                        {x.shared} of {x.shows}
                      </td>
                      <td>
                        {pct(x.roomRouted)} / {pct(x.roomGuess)}
                      </td>
                      <td>{x.missed ? `${x.missed.city} (#${x.missed.rank})` : "–"}</td>
                      <td>{x.worst ? `${x.worst.city} (${x.worst.rank ? `#${x.worst.rank}` : "not a touring city"})` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${s.sec} ${s.cols}`} aria-labelledby="method-title">
            <div>
              <h2 id="method-title" className={s.h2}>
                How it&apos;s measured
              </h2>
              <p>
                Both tours use the same model (NVIDIA Nemotron 3 Ultra), the same number of shows, the same starting city and the same crowd size. The model alone gets the artist&apos;s name and nothing else; Routed&apos;s agent gets Qloo&apos;s heatmap ranking and its per-city lookups.
              </p>
              <p>
                A city&apos;s rank is its place among every touring city in the region (a city of 50,000 or more with its suburbs) on this artist&apos;s heatmap, ordered by how far fans over-index there times how much taste signal the place carries, all from one heatmap call so every tile shares one scale. A model-alone city is placed by its name, then by the named room&apos;s coordinates on Qloo, then by Qloo&apos;s locality search; a stop that resolves to a real town with no touring city within 60 km counts last, and one that can&apos;t be placed at all is left out rather than counted against the model. Rooms on both sides are scored in one Qloo call, restricted to exactly those rooms, so they share a scale.
              </p>
              <details className={s.prompt}>
                <summary>The exact prompt the model alone gets</summary>
                <pre>{CONTROL_PROMPT}</pre>
                <p>followed by the artist&apos;s name, the region, the starting city, the number of shows and the usual crowd.</p>
              </details>
            </div>
            <div>
              <h2 className={s.h2}>What this does and doesn&apos;t show</h2>
              <p>
                It measures with Qloo&apos;s own ruler, and says so: Routed chooses from the heatmap ranking it is then scored on, so what the number shows is how far a model routing from memory strays from where the taste graph puts the fans, not that the graph is right. It can&apos;t show ticket sales: those aren&apos;t public. One outside check is on the page: each benchmark tour starts from the artist&apos;s home base, which the heatmap knows nothing about, and it ranks the home base here:
              </p>
              {homes.length > 0 && (
                <ul className={s.homes}>
                  {homes.map((x) => (
                    <li key={x.id}>
                      {x.artist}, {x.from.split(",")[0]}: <b>#{x.home}</b> of {x.ranked}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const pct = (v?: number) => (v === undefined ? "–" : String(Math.round(v * 100)));

function pos(rank: number, cap: number): number {
  return 10 + ((Math.min(rank, cap) - 1) / Math.max(1, cap - 1)) * 580;
}
