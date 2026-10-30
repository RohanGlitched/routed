"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Poster } from "@/components/poster/Poster";
import { posterFor } from "@/lib/poster";
import { displayTags } from "@/lib/tags";
import { fillDates, runLegs } from "@/lib/geo/fill";
import type { LogLine, Plan, Stop, TourRecord } from "@/lib/types";
import type { Rerun } from "./AgentCheck";
import { FLAGSHIP, realityCount, type RealityCheck } from "./Reality";
import { sizeNote } from "@/lib/agent/evidence";
import { agentStory, checkLine, fillOption, jumpsLine, legsLead, plural, sheetCounts, shownCapacity, swapRows, type SwapRow } from "./display";
import { LocalMap } from "./LocalMap";
import p from "./present.module.css";

type Contrast = { n: number; meanA: number; meanB: number; diff: number; wins: number; losses: number; ties: number; p: number };
/** /proof's post-cutoff headline, as the server read it from data/outside2/results.json. */
export type ProofHeadline = { tours: number; blend: Contrast; model?: Contrast };

type Slide = { key: string; title: string; body: ReactNode };

const day = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}`;
const pc1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const pv = (x: number) => (x < 0.001 ? "p < 0.001" : `p = ${x.toFixed(x < 0.01 ? 3 : 2)}`);
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
/** A checked line with its struck figures shown struck, as the day sheet prints it. */
const Checked = ({ text }: { text: string }) => (
  <>{text.split(/(~~[^~]+~~)/g).map((x, i) => (x.startsWith("~~") ? <del key={i}>{x.slice(2, -2)}</del> : <span key={i}>{x}</span>))}</>
);

/**
 * A tour as slides, for presenting live: the poster, the stops Qloo changed, the strongest stop's day sheet, the
 * call sheet in numbers and /proof's headline. It reads the stored tour only (no run), and steps with the arrow
 * keys, a click or a tap (left third goes back); F goes full screen and Escape leaves.
 */
export function Present({
  rec,
  proof,
  rerun,
  reality,
}: {
  rec: TourRecord;
  proof: ProofHeadline | null;
  /** A re-run where the agent cleared its own objections. */
  rerun?: Rerun;
  /** The flagship against the artist's real tour, when data/flagship-reality.json is there. */
  reality?: RealityCheck;
}) {
  const plan = rec.plan as Plan;
  const slides = useMemo(() => buildSlides(rec, plan, proof, rerun, reality), [rec, plan, proof, rerun, reality]);
  const [i, setI] = useState(0);
  const n = slides.length;
  const go = useCallback((to: number) => setI(Math.max(0, Math.min(n - 1, to))), [n]);

  // The deck covers the page: the page under it doesn't scroll.
  useEffect(() => {
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = was;
    };
  }, []);

  // The slide is in the hash (#3), so a reload or a shared link opens where it was.
  useEffect(() => {
    const k = Number(location.hash.slice(1));
    if (k >= 1 && k <= n) setI(k - 1);
  }, [n]);
  useEffect(() => {
    history.replaceState(null, "", `#${i + 1}`);
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        setI((x) => Math.min(n - 1, x + 1));
      } else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        setI((x) => Math.max(0, x - 1));
      } else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(n - 1);
      else if (e.key === "f" || e.key === "F") toggleFull();
      else if (e.key === "Escape" && !document.fullscreenElement) location.assign(`/tour/${rec.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n, rec.id]);

  const slide = slides[i]!;
  return (
    <div className={p.deck} role="region" aria-roledescription="slide deck" aria-label={`${plan.artist.name}, presented`}>
      <header className={p.bar}>
        <p className={p.where}>
          <b>{plan.artist.name}</b> <span>{slide.title}</span>
        </p>
        <div className={p.barActions}>
          <button type="button" onClick={toggleFull} className={p.textButton}>
            Full screen
          </button>
          <Link href={`/tour/${rec.id}`} className={p.textButton}>
            Back to the tour book
          </Link>
        </div>
      </header>

      <section
        className={p.stage}
        aria-roledescription="slide"
        aria-label={`${slide.title}, ${i + 1} of ${n}`}
        aria-live="polite"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a, button")) return;
          const r = e.currentTarget.getBoundingClientRect();
          go(e.clientX - r.left < r.width / 3 ? i - 1 : i + 1);
        }}
      >
        <div className={p.slide} key={slide.key}>
          {slide.body}
        </div>
      </section>

      <footer className={p.foot}>
        <button type="button" className={p.step} onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide">
          ←
        </button>
        <ol className={p.dots}>
          {slides.map((x, k) => (
            <li key={x.key}>
              <button type="button" onClick={() => go(k)} aria-current={k === i ? "step" : undefined} className={p.dot}>
                <span className={p.dotNum}>{k + 1}</span> <span className={p.dotName}>{x.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className={p.step} onClick={() => go(i + 1)} disabled={i === n - 1} aria-label="Next slide">
          →
        </button>
      </footer>
    </div>
  );
}

function toggleFull() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

function buildSlides(rec: TourRecord, plan: Plan, proof: ProofHeadline | null, rerun?: Rerun, reality?: RealityCheck): Slide[] {
  const stops = plan.stops;
  const artist = plan.artist.name;
  const shows = stops.reduce((k, s) => k + (s.nights ?? 1), 0);
  const poster = posterFor(plan);
  const out: Slide[] = [];
  // The run in legs and the fill dates on its dark days, from the stored stops and fan map (lib/geo/fill.ts).
  const legs = runLegs(stops);
  const fills = plan.cities?.length ? fillDates(stops, plan.cities, plan.region).filter((f) => f.options.length) : [];

  out.push({
    key: "poster",
    title: "The poster",
    body: (
      <div className={p.posterSlide}>
        <div className={p.posterBox}>{poster && <Poster {...poster} />}</div>
        <div className={p.copy}>
          <p className={p.kicker}>Routed on Qloo&apos;s taste graph</p>
          <h1 className={p.wood}>{artist}</h1>
          <p className={p.lead}>
            <span className="num">{shows}</span> shows{shows > stops.length ? ` in ${stops.length} cities` : ""}, {day(stops[0]!.date, { month: "long", day: "numeric" })} to {day(plan.lastDate ?? stops.at(-1)!.date, { month: "long", day: "numeric" })}, from {plan.from.label.split(",")[0]}
            {plan.cities?.length ? (
              <>
                , chosen from <span className="num">{plan.cities.length}</span> cities where Qloo found fans.
              </>
            ) : (
              "."
            )}
          </p>
          {legs && (
            <p className={p.legs}>
              <b>{legsLead(legs)}</b> {jumpsLine(legs)}
            </p>
          )}
          {fills.length > 0 && (
            <div className={p.fills}>
              <h3>Fill dates on the way</h3>
              <ul>
                {fills.map((f) => (
                  <li key={f.index}>
                    <span className={p.fillLeg}>
                      {f.from} to {f.to}
                    </span>
                    <span>
                      {f.options.map((o, k) => {
                        const x = fillOption(o);
                        return (
                          <span key={o.marketId}>
                            {k > 0 && ", "}
                            <b>{x.city}</b> ({x.note})
                          </span>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className={p.note}>
            Every blue dot is a tile of {artist}&apos;s Qloo heatmap, sized by how strongly fans over-index there. The fire line is the route.
            {fills.length ? " Fill dates are fan cities from the same map that the band could play on a dark day and still make the next show." : ""}
          </p>
        </div>
      </div>
    ),
  });

  const d = plan.qlooDiff;
  if (d) {
    const total = d.kept + d.added.length;
    // The other baseline: the same model routing the same tour without Qloo (the control group on the tour page).
    const guessed = plan.guess?.stops.length ? new Set(plan.guess.stops.map((g) => g.marketId ?? g.city)) : null;
    const missed = guessed ? stops.filter((x) => !guessed.has(x.marketId) && !guessed.has(x.city)).length : null;
    out.push({
      key: "changed",
      title: "Stops Qloo changed",
      body: (
        <div className={`${p.changed}${reality ? ` ${p.changedTight}` : ""}`}>
          <div className={p.changedHead}>
            <h2 className={p.h2}>Stops Qloo changed</h2>
            <div className={p.bigs}>
              <p className={p.big}>
                <b className="num">{d.added.length}</b> of <span className="num">{total}</span>
                <span className={p.bigLabel}>stops changed against the same rules on city size alone</span>
              </p>
              {missed !== null && (
                <p className={`${p.big} ${p.bigBlue}`}>
                  <b className="num">{missed}</b> of <span className="num">{stops.length}</span>
                  <span className={p.bigLabel}>cities the same model without Qloo didn&apos;t pick</span>
                </p>
              )}
            </div>
          </div>
          <p className={p.lead}>
            {d.added.length
              ? `The same rules, re-run on city size alone with no Qloo data, would keep ${d.kept} of these cities and swap the rest for bigger ones.`
              : `The same rules, re-run on city size alone with no Qloo data, pick the same ${total} cities: on this tour Qloo's map and city size agree.`}
          </p>
          {reality && <RealityLine data={reality} tourId={rec.id} />}
          {d.added.length > 0 && (
            <div className={p.cols}>
              <div>
                <h3 className={p.colFire}>Qloo put on the tour</h3>
                <ul className={p.rows}>
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
              <div>
                <h3 className={p.colMute}>City size alone would play</h3>
                <ul className={`${p.rows} ${p.rowsMute}`}>
                  {d.dropped.map((x) => (
                    <li key={x.marketId}>
                      <b>{x.city}</b>
                      <span>
                        size <span className="num">#{x.popRank}</span>, {x.fanRank ? <>fan <span className="num">#{x.fanRank}</span></> : "no fan signal"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <p className={p.note}>Fan rank is the city&apos;s place on {artist}&apos;s Qloo heatmap; size rank its place by population among the region&apos;s touring cities.</p>
        </div>
      ),
    });
  }

  // The strongest stop: the best fan city on the tour.
  const best = [...stops].sort((a, b) => a.score.rank - b.score.rank)[0]!;
  out.push({ key: "day", title: `A day in ${best.city}`, body: <DaySlide stop={best} plan={plan} artist={artist} draw={rec.input.draw} /> });

  const counts = sheetCounts(rec.log);
  const u = rec.engine?.usage;
  const swaps = swapRows(rec.log, stops).slice(0, 3);
  const story = agentStory(rec.log);
  const c = rec.engine?.check;
  // The call sheet leads with a loop where the agent cleared check_plan's objections itself (the Oct 30 re-run), when
  // this tour's own loop left objections for the rules; this tour's rows follow under their own label.
  const clean = rerun?.rows?.length && c?.after && rerun.id !== rec.id ? rerun : undefined;
  const ownLead =
    c && story ? (
      <>
        {story.first.length ? `The agent proposed, check_plan objected ${story.first.length === 1 ? "once" : `${story.first.length} times`}` : "The agent's booking cleared every rule"}
        {story.rounds.length ? `, and the agent re-booked over ${plural(story.rounds.length, "round")}` : ""}
        {story.first.length ? (story.cleared ? ", clearing every objection itself." : `; the rules settled the last ${story.rounds.at(-1)?.left.length ?? story.first.length}${c.ruled ? `, changing ${c.ruled} of ${c.stops} stops` : ""}.`) : "."}
      </>
    ) : c ? (
      checkLine(c)
    ) : null;
  out.push({
    key: "calls",
    title: "The call sheet",
    body: (
      <div className={p.calls}>
        <h2 className={p.h2}>The call sheet</h2>
        <div className={p.stats}>
          {u ? (
            <div className={p.statFire}>
              <b className="num">{u.qloo}</b>
              <span>requests sent to Qloo for this tour</span>
            </div>
          ) : (
            <div className={p.statFire}>
              <b className="num">{counts.qloo}</b>
              <span>Qloo lines on the call sheet</span>
            </div>
          )}
          <div>
            <b className="num">{u?.modelCalls ?? counts.model}</b>
            <span>{u ? "model calls" : "agent steps"}</span>
          </div>
          <div>
            <b className="num">{counts.rule}</b>
            <span>rule checks</span>
          </div>
          <div>
            <b className="num">{counts.web}</b>
            <span>web lookups, for room sizes</span>
          </div>
        </div>
        {clean ? (
          <>
            <h3 className={p.loopHead}>
              The agent clears its own: <Link href={`/tour/${clean.id}`}>{clean.artist}</Link>, on the {clean.date} loop
            </h3>
            <p className={p.loopLead}>
              check_plan objected {clean.before === 1 ? "once" : `${clean.before} times`}
              {clean.first?.length ? `: ${clean.first.join("; ")}` : ""}. The agent re-booked in {clean.rounds === 1 ? "one round" : `${clean.rounds} rounds`}, and every rule cleared.
            </p>
            <SwapTable rows={clean.rows!} />
            {swaps.length > 0 || ownLead ? (
              <>
                <h3 className={p.olderHead}>{rec.id === FLAGSHIP ? "On the flagship" : "On this tour"} (older loop)</h3>
                {ownLead && <p className={p.olderLead}>{ownLead}</p>}
                {swaps.length > 0 && <SwapTable rows={swaps} small />}
              </>
            ) : null}
          </>
        ) : (
          <>
            {ownLead && <p className={p.lead}>{ownLead}</p>}
            {swaps.length > 0 && <SwapTable rows={swaps} />}
            {rerun && c?.after && rerun.id !== rec.id ? (
              <p className={p.note}>
                On a re-run with the {rerun.date} loop the agent cleared its own:{" "}
                <Link href={`/tour/${rerun.id}`}>
                  {rerun.artist}, {rerun.before === 1 ? "one objection" : `${rerun.before} objections`} to none in {rerun.rounds === 1 ? "one round" : `${rerun.rounds} rounds`}
                </Link>
                .
              </p>
            ) : null}
          </>
        )}
        <p className={p.note}>
          Every request is on the call sheet at the end of the tour book. The tour book also downloads the routing grid as a CSV and copies every hold request at once.
        </p>
      </div>
    ),
  });

  if (proof) {
    const b = proof.blend;
    out.push({
      key: "proof",
      title: "Tours the model can't have read",
      body: (
        <div className={p.proof}>
          <p className={p.kicker}>Tours the model can&apos;t have read</p>
          <p className={p.huge}>
            <b className="num">{pts(b.diff)}</b> <span>pts</span>
          </p>
          <p className={p.lead}>
            On <span className="num">{proof.tours}</span> tours announced after the model&apos;s release, Qloo + population found <b className="num">{pc1(b.meanA)}</b> of the cities each tour announced. Population alone found <span className="num">{pc1(b.meanB)}</span> ({pv(b.p)}).
          </p>
          <div className={p.stats}>
            <div className={p.statFire}>
              <b className="num">{b.wins}</b>
              <span>artists better</span>
            </div>
            <div>
              <b className="num">{b.losses}</b>
              <span>worse</span>
            </div>
            <div>
              <b className="num">{b.ties}</b>
              <span>{b.ties === 1 ? "tie" : "ties"}</span>
            </div>
            <div>
              <b className="num">{proof.tours}</b>
              <span>tours, all announced after the model&apos;s release</span>
            </div>
          </div>
          {proof.model && (
            <p className={p.note}>
              Qloo&apos;s ranking against the model alone on the same tours: {pts(proof.model.diff)} pts, not significant ({proof.model.wins}–{proof.model.losses}–{proof.model.ties}, {pv(proof.model.p)}). The protocol, every tour and every list are on <Link href="/proof">/proof</Link>.
            </p>
          )}
        </div>
      ),
    });
  }
  return out;
}

/** The reality check in one line: how many of the tour's cities the artist really played, and the real rooms. */
function RealityLine({ data, tourId }: { data: RealityCheck; tourId: string }) {
  const { on, of } = realityCount(data);
  const crowd = data.usualCrowd;
  return (
    <p className={p.reality}>
      <b>Reality check:</b> <span className="num">{on}</span> of <span className="num">{of}</span> of these cities were on {data.artist}&apos;s {data.tour.name} ({data.tour.years})
      {crowd?.realMedian ? `; its rooms' median is ${crowd.realMedian.toLocaleString("en-US")}, against the ${crowd.input.toLocaleString("en-US")} Routed was given` : ""}.{" "}
      <Link href={`/tour/${tourId}#reality-check`}>Every city and source</Link>
    </p>
  );
}

/** Proposed, objected, re-chose, booked: one row per city the check sent back. */
function SwapTable({ rows, small }: { rows: SwapRow[]; small?: boolean }) {
  return (
    <table className={`${p.swaps}${small ? ` ${p.swapsSmall}` : ""}`}>
      <thead>
        <tr>
          <th scope="col">Agent proposed</th>
          <th scope="col">Rule objected</th>
          <th scope="col">Agent re-chose</th>
          <th scope="col">Booked</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, k) => (
          <tr key={k}>
            <td className={p.proposed}>{s.proposed}</td>
            <td>{s.objection}</td>
            <td className={p.chose}>{s.chose}</td>
            <td className={p.booked}>
              <b>{s.booked}</b>
              {s.rule && <span>By rule: {s.rule}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The room's size in the tour book's own words (lib/agent/evidence.ts sizeNote): "Holds 1,050 of a usual crowd
 *  of 1,500 in one night. Capacity per wikipedia.org." A note that doesn't name the capacity gets it first. */
function roomLine(capacity: number, source: string, draw?: number, nights?: number): string {
  const holds = `Holds ${capacity.toLocaleString("en-US")}, per ${source}.`;
  if (!draw) return holds;
  const note = sizeNote(capacity, draw, nights ?? 1).text;
  return /^Holds [\d,]+ /.test(note) ? `${note} Capacity per ${source}.` : `${holds} ${note}`;
}

function DaySlide({ stop, plan, artist, draw }: { stop: Stop; plan: Plan; artist: string; draw?: number }) {
  const room = stop.rooms.find((r) => r.id === stop.roomId) ?? stop.rooms[0];
  const others = stop.rooms.filter((r) => r !== room).slice(0, 2);
  const cap = room ? shownCapacity(room) : undefined;
  const opener = stop.openers.find((o) => o.id === stop.openerId) ?? stop.openers[0];
  const ranked = stop.rooms.filter((r) => r.affinity !== undefined).sort((a, b) => b.affinity! - a.affinity!);
  const roomRank = room && ranked.length > 1 ? ranked.indexOf(room) + 1 : 0;
  return (
    <div className={p.daySlide}>
      {stop.local ? (
        <div className={p.map}>
          <LocalMap local={stop.local} room={room} others={others} city={stop.city} artist={artist} places={[...stop.rooms, ...(stop.posters ?? []), ...stop.after]} spots={[...(stop.posters ?? []), ...stop.after]} />
        </div>
      ) : null}
      <div className={p.copy}>
        <p className={p.kicker}>{day(stop.date, { weekday: "long" })}</p>
        <p className={p.date}>{day(stop.date, { month: "short", day: "numeric" })}</p>
        <h2 className={p.city}>{stop.label}</h2>
        <p className={p.badges}>
          <span>
            Fan city <b className="num">{stop.score.rank}</b> of <span className="num">{plan.cities.length}</span>
          </span>
          {roomRank > 0 && (
            <span>
              Fans&apos; <b className="num">#{roomRank}</b> room of <span className="num">{ranked.length}</span>
            </span>
          )}
        </p>
        <dl className={p.facts}>
          {room && (
            <>
              <dt>Room</dt>
              <dd>
                <b>{room.name}</b>
                <span>
                  {room.affinity !== undefined ? `Fan affinity ${Math.round(room.affinity * 100)}. ` : ""}
                  {cap ? roomLine(cap.value, /^https?:\/\//.test(cap.source) ? host(cap.source) : cap.source, draw, stop.nights) : "No published capacity: ask the room."}
                </span>
              </dd>
            </>
          )}
          {opener && (
            <>
              <dt>Support</dt>
              <dd>
                <b>{opener.name}</b>
                <span>
                  {opener.affinity !== undefined ? `Audience affinity ${Math.round(opener.affinity * 100)}. ` : ""}
                  {opener.genres?.length ? `${displayTags(opener.genres).slice(0, 2).join(", ")}.` : ""}
                </span>
              </dd>
            </>
          )}
        </dl>
        {stop.why && (
          <p className={p.why}>
            <Checked text={stop.why} />
          </p>
        )}
      </div>
    </div>
  );
}
