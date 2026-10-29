"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Poster } from "@/components/poster/Poster";
import { posterFor } from "@/lib/poster";
import { displayTags } from "@/lib/tags";
import type { Plan, Stop, TourRecord } from "@/lib/types";
import { checkLine, plural, sheetCounts, shownCapacity } from "./display";
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
export function Present({ rec, proof }: { rec: TourRecord; proof: ProofHeadline | null }) {
  const plan = rec.plan as Plan;
  const slides = useMemo(() => buildSlides(rec, plan, proof), [rec, plan, proof]);
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

function buildSlides(rec: TourRecord, plan: Plan, proof: ProofHeadline | null): Slide[] {
  const stops = plan.stops;
  const artist = plan.artist.name;
  const shows = stops.reduce((k, s) => k + (s.nights ?? 1), 0);
  const poster = posterFor(plan);
  const out: Slide[] = [];

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
          <p className={p.note}>Every blue dot is a tile of {artist}&apos;s Qloo heatmap, sized by how strongly fans over-index there. The fire line is the route.</p>
        </div>
      </div>
    ),
  });

  const d = plan.qlooDiff;
  if (d) {
    const total = d.kept + d.added.length;
    out.push({
      key: "changed",
      title: "Stops Qloo changed",
      body: (
        <div className={p.changed}>
          <div className={p.changedHead}>
            <h2 className={p.h2}>Stops Qloo changed</h2>
            <p className={p.big}>
              <b className="num">{d.added.length}</b> of <span className="num">{total}</span>
            </p>
          </div>
          <p className={p.lead}>
            {d.added.length
              ? `The same rules, re-run on city size alone with no Qloo data, would keep ${d.kept} of these cities and swap the rest for bigger ones.`
              : `The same rules, re-run on city size alone with no Qloo data, pick the same ${total} cities: on this tour Qloo's map and city size agree.`}
          </p>
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
  const swaps = rec.log.flatMap((l) => l.swaps ?? []).filter((s) => !/agent's own change/i.test(s.objection)).slice(0, 3);
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
              <span>requests sent to Qloo</span>
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
        {rec.engine?.check && <p className={p.lead}>{checkLine(rec.engine.check)}</p>}
        {swaps.length > 0 && (
          <table className={p.swaps}>
            <thead>
              <tr>
                <th scope="col">Agent proposed</th>
                <th scope="col">Rule objected</th>
                <th scope="col">Agent re-chose</th>
              </tr>
            </thead>
            <tbody>
              {swaps.map((s, k) => (
                <tr key={k}>
                  <td className={p.proposed}>{s.proposed}</td>
                  <td>{s.objection}</td>
                  <td className={p.chose}>{s.chose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={p.note}>
          {u ? `${counts.withRequest} of the ${plural(counts.qloo, "Qloo line")} carry their exact request; the rest of the requests are place searches by name, summed up in one line each. ` : ""}
          Every step is on the call sheet at the end of the tour book.
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
                  {cap ? `Holds ${cap.value.toLocaleString("en-US")}, per ${/^https?:\/\//.test(cap.source) ? host(cap.source) : cap.source}.` : "No published capacity: ask the room."}
                  {draw ? ` Sized for a crowd of ${draw.toLocaleString("en-US")}.` : ""}
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
