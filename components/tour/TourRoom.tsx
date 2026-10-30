"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Poster } from "@/components/poster/Poster";
import { posterFor, season } from "@/lib/poster";
import type { LogLine, Plan, TourRecord } from "@/lib/types";
import { Audience } from "./Audience";
import { CallSheet } from "./CallSheet";
import { DaySheet } from "./DaySheet";
import { downloadPoster } from "./download";
import { tourCalendar } from "@/lib/ics";
import { allHolds, exportName, routingCsv } from "@/lib/export";
import { Campaign } from "./Campaign";
import { Control } from "./Control";
import { QlooDiff } from "./QlooDiff";
import { AssumedDraw } from "@/components/home/AssumedDraw";
import { aside } from "@/lib/tags";
import { fillDates, runLegs } from "@/lib/geo/fill";
import { AgentCheck, type Rerun } from "./AgentCheck";
import { agentStory, checkLine, jumpsLine, legsLead, plural, sheetCounts, stopAnchor } from "./display";
import { StopStrip } from "./StopStrip";
import { Reality, type RealityCheck } from "./Reality";
import a from "./agent.module.css";
import s from "./tour.module.css";

type Event = { t: "log"; line: LogLine } | { t: "plan"; plan: Partial<Plan> } | { t: "done"; at: string; engine: TourRecord["engine"] } | { t: "error"; message: string };

const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * One tour: streams the agent's run when it's fresh (each Qloo call appears on the call sheet as it happens, the
 * poster fills in as the plan does), and shows the finished tour book on a revisit or a shared link.
 */
export function TourRoom({
  initial,
  rerun,
  reality,
}: {
  initial: TourRecord;
  /** A re-run where the agent cleared its own objections, for tours where it didn't. */
  rerun?: Rerun;
  /** The flagship against the artist's real tour (data/flagship-reality.json), when that file is there. */
  reality?: RealityCheck;
}) {
  const [rec, setRec] = useState<TourRecord>(initial);
  const started = useRef(false);
  const posterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initial.status === "queued") void stream();
    else if (initial.status === "running") void poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function stream(): Promise<void> {
    setRec((r) => ({ ...r, status: "running", log: [] }));
    try {
      const res = await fetch(`/api/tours/${initial.id}/run`, { method: "POST" });
      if (res.status === 409) return poll();
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "The routing couldn't start.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) apply(JSON.parse(line) as Event);
        }
      }
      // The stream ended: the saved record is the truth (covers a dropped "done").
      const fin = await fetch(`/api/tours/${initial.id}`, { cache: "no-store" }).then((r) => r.json() as Promise<TourRecord>);
      if (fin.status !== "running") setRec(fin);
    } catch (e) {
      setRec((r) => ({ ...r, status: "failed", error: (e as Error).message }));
    }
  }

  function apply(e: Event) {
    setRec((r) => {
      if (e.t === "log") return { ...r, log: [...r.log, e.line] };
      if (e.t === "plan") return { ...r, plan: { ...(r.plan ?? ({} as Plan)), ...e.plan } as Plan };
      if (e.t === "done") return { ...r, status: "done", engine: e.engine, finishedAt: e.at };
      return { ...r, status: "failed", error: e.message };
    });
  }

  async function poll(): Promise<void> {
    for (let i = 0; i < 160; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const r = await fetch(`/api/tours/${initial.id}`, { cache: "no-store" }).then((x) => x.json() as Promise<TourRecord>).catch(() => null);
      if (!r) continue;
      setRec(r);
      if (r.status === "done" || r.status === "failed") return;
      // A run that stopped reporting (its function was killed) is claimed again and streamed from the start.
      if (r.status === "running" && r.startedAt && Date.now() - Date.parse(r.startedAt) > 6 * 60_000) return stream();
    }
    setRec((r) => ({ ...r, status: "failed", error: "The routing is taking too long. Run it again in a minute." }));
  }

  const plan = rec.plan;
  const poster = useMemo(() => (plan ? posterFor(plan) : null), [plan]);
  const running = rec.status === "queued" || rec.status === "running";
  const stops = plan?.stops ?? [];
  const title = plan?.artist?.name ?? rec.input.artist;
  const done = rec.status === "done";
  // Fill dates for the dark days and the run in legs, from the stored stops and fan map only (lib/geo/fill.ts).
  const fills = useMemo(() => (done && plan?.stops?.length && plan.cities?.length ? fillDates(plan.stops, plan.cities, plan.region) : []), [done, plan]);
  const legs = useMemo(() => (done && plan?.stops?.length ? runLegs(plan.stops) : null), [done, plan]);
  const firstFill = fills.find((f) => f.options.length);
  const story = useMemo(() => (done ? agentStory(rec.log) : null), [done, rec.log]);

  return (
    <div className={`wrap ${s.room}`} data-status={rec.status}>
      <div className={s.top}>
        <div className={s.posterCol}>
          <div className={s.posterBox} ref={posterRef}>
            {poster ? <Poster {...poster} print={rec.status === "done" && initial.status !== "done"} rowHref={rec.status === "done" ? (i) => `#${stopAnchor(i)}` : undefined} /> : <div className={s.posterBlank}>{running ? "Reading the taste graph…" : "No poster"}</div>}
          </div>
          {rec.status === "done" && poster && (
            <div className={s.posterActions}>
              <button type="button" onClick={() => posterRef.current && downloadPoster(posterRef.current, `${title} ${season(plan!.firstDate)}`)}>
                Download poster
              </button>
              <button type="button" onClick={() => saveCalendar(plan!, rec.id, title)}>
                Add to calendar
              </button>
              <button type="button" onClick={() => window.print()}>
                Print the tour book
              </button>
              <button type="button" onClick={() => saveGrid(plan!, title, rec.input.draw ?? plan!.assumedDraw)}>
                Download routing grid (CSV)
              </button>
              <CopyHolds plan={plan!} />
              <CopyLink />
              <Link href={`/tour/${rec.id}/present`} className={s.presentLink}>
                Present it
              </Link>
            </div>
          )}
        </div>

        <div className={s.head}>
          <p className={s.kicker}>{running ? "Routing now" : rec.status === "failed" ? "Routing stopped" : `Routed ${new Date(rec.finishedAt ?? rec.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`}</p>
          <h1 className={s.title}>{title}</h1>
          {stops.length > 0 ? (
            <p className={s.summary}>
              <span className="num">{stops.reduce((n, x) => n + (x.nights ?? 1), 0)}</span> shows{stops.some((x) => (x.nights ?? 1) > 1) ? ` in ${stops.length} cities` : ""}, {short(stops[0]!.date)} to {short(plan!.lastDate ?? stops.at(-1)!.date)}, starting from {plan!.from.label}. About <span className="num">{plan!.totalKm.toLocaleString("en-US")}</span> km of road
              {plan!.cities?.length ? (
                <>
                  , chosen from <span className="num">{plan!.cities.length}</span> cities where Qloo found fans.
                </>
              ) : (
                "."
              )}
            </p>
          ) : (
            <p className={s.summary}>
              {rec.input.shows} shows from {rec.input.from}, first show {short(rec.input.firstDate)}.
            </p>
          )}

          {legs && (
            <p className={s.legs}>
              <b>{legsLead(legs)}</b> {jumpsLine(legs)}
              {firstFill ? (
                <>
                  {" "}
                  <a href={`#${stopAnchor(firstFill.index)}`}>Fill dates for the dark days</a> are on the day sheets.
                </>
              ) : null}
            </p>
          )}
          {plan?.assumedDraw ? <AssumedDraw draw={plan.assumedDraw} artist={plan.artist.name} from={rec.input.from} /> : null}
          {plan?.readThrough?.length ? (
            <p className={a.note}>
              {title}&apos;s own Qloo heatmap was too thin to route, so the map is <b>read through {list(plan.readThrough.map((x) => x.name))}</b>: the cities where audiences like {title}&apos;s over-index.
            </p>
          ) : null}
          {plan?.artist?.others?.length ? (
            <p className={s.others}>
              Qloo matched <b>{plan.artist.name}</b>{aside(plan.artist.name, plan.artist.disambiguation) ? ` (${aside(plan.artist.name, plan.artist.disambiguation)})` : ""}. Not the one you meant? Route{" "}
              {plan.artist.others.map((o, i) => (
                <span key={o.name}>
                  {i > 0 && (i === plan.artist.others!.length - 1 ? " or " : ", ")}
                  <Link href={`/?artist=${encodeURIComponent(o.name)}&from=${encodeURIComponent(rec.input.from)}`}>{o.name}</Link>
                  {aside(o.name, o.disambiguation) ? ` (${aside(o.name, o.disambiguation)})` : ""}
                </span>
              ))}
              {" "}instead.
            </p>
          ) : null}
          {rec.status === "failed" && (
            <div className={s.failed} role="alert">
              <p>{rec.error ?? "The routing stopped partway."}</p>
              <Link href={`/?artist=${encodeURIComponent(rec.input.artist)}`}>Try again</Link>
            </div>
          )}

          {(running || !plan?.audience) && <CallSheet log={rec.log} running={running} />}
          {!running && plan?.audience && <Audience plan={plan} />}
          {rec.engine && !running && (
            <p className={s.engine}>
              {rec.engine.planned === "model" ? `Planned by ${rec.engine.agent ?? "the agent"}` : "Planned by the fixed plan (the agent model was unavailable)"}
              {rec.engine.writer ? `; pitches by ${rec.engine.writer}` : "; template pitches"}.
              {rec.engine.check && !story ? ` ${checkLine(rec.engine.check)}` : ""}
              {rec.engine.usage ? ` ${usageLine(rec.engine.usage)}` : ""} The call sheet at the end of the tour book lists every step.
            </p>
          )}
          {rec.engine?.check && story && <AgentCheck log={rec.log} check={rec.engine.check} rerun={rerun && rerun.id !== rec.id ? rerun : undefined} />}
        </div>
      </div>

      {stops.length > 0 && !running && <StopStrip stops={stops} control={!!plan?.guess?.stops.length} callSheet={rec.log.length > 0} />}

      {stops.length > 0 && (
        <section className={s.book} aria-labelledby="book-title">
          <h2 id="book-title" className={s.h2}>
            The tour book
          </h2>
          {plan!.audience?.advice && <p className={s.advice}>{plan!.audience.advice}</p>}
          {plan!.tradeOff && <p className={s.advice}>Routing: {plan!.tradeOff}.</p>}
          {!running && <QlooDiff plan={plan!} />}
          {!running && reality && <Reality data={reality} />}
          <ol className={s.sheets}>
            {stops.map((st, i) => (
              <DaySheet key={st.marketId} anchor={stopAnchor(i)} stop={st} prev={i === 0 ? plan!.from.label.split(",")[0]! : stops[i - 1]!.city} total={plan!.cities.length} artist={title} pending={running} draw={rec.input.draw} first={i === 0} genres={plan!.artist.genreKeys ?? plan!.artist.genres} fill={fills.find((f) => f.index === i)} />
            ))}
          </ol>
        </section>
      )}

      {!running && plan?.guess && <Control plan={plan} agent={rec.engine?.agent} />}
      {!running && plan?.audience && <Campaign plan={plan} />}

      {!running && rec.log.length > 0 && (
        <details className={s.trace} id="call-sheet">
          <summary>How the agent got here: the call sheet, {traceLine(sheetCounts(rec.log))}</summary>
          {rec.engine?.usage && <p className={s.traceNote}>{gapLine(sheetCounts(rec.log), rec.engine.usage)}</p>}
          <CallSheet log={rec.log} running={false} full />
        </details>
      )}
    </div>
  );
}

/** The run's own tally, in one sentence: requests that went to Qloo over the network, and the model's share. */
function usageLine(u: NonNullable<NonNullable<TourRecord["engine"]>["usage"]>): string {
  const stored = u.qlooCached ? ` (${u.qlooCached} more ${u.qlooCached === 1 ? "was" : "were"} answered from a stored copy)` : "";
  return `This run${u.seconds ? ` took ${u.seconds} s,` : ""} sent ${plural(u.qloo, "request")} to Qloo${stored}, made ${plural(u.modelCalls, "model call")} and used ${u.tokensIn + u.tokensOut > 0 ? (u.tokensIn + u.tokensOut).toLocaleString("en-US") : "no"} tokens.`;
}

/** "76 Qloo lines, 6 agent steps, 23 rule checks and 67 web lookups". */
function traceLine(c: ReturnType<typeof sheetCounts>): string {
  return list([plural(c.qloo, "Qloo line"), ...(c.model ? [plural(c.model, "agent step")] : []), ...(c.rule ? [plural(c.rule, "rule check")] : []), ...(c.web ? [plural(c.web, "web lookup")] : [])]);
}

/**
 * Why the head's request count and the call sheet's Qloo lines differ: the tally counts every request sent
 * (lib/usage.ts, retries included), while the sheet gives one line to each question, and a set of place
 * searches by name (the rooms the agent and the model-alone tour named) is summed up in one line.
 */
function gapLine(c: ReturnType<typeof sheetCounts>, u: NonNullable<NonNullable<TourRecord["engine"]>["usage"]>): string {
  const sent = u.qloo + u.qlooCached;
  const lead = `This run sent ${plural(u.qloo, "request")} to Qloo${u.qlooCached ? ` and answered ${u.qlooCached} from a stored copy` : ""}.`;
  if (sent <= c.withRequest) return `${lead} Each one is listed below with its exact request.`;
  return `${lead} ${c.withRequest} of the ${plural(c.qloo, "Qloo line")} below carry their exact request; the other requests are place searches by name for the rooms the agent and the model-alone tour named, each set summed up in the line that reports it, and any retries.`;
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The tour as an .ics file: every show, travel day and day off, for the band's shared calendar. */
function saveCalendar(plan: Plan, id: string, title: string) {
  const ics = tourCalendar(plan, id, location.origin);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  a.download = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-tour.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** The routing grid as a spreadsheet: one row a show, the columns a booker fills a routing sheet with (lib/export.ts). */
function saveGrid(plan: Plan, title: string, draw?: number) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([routingCsv(plan, draw)], { type: "text/csv;charset=utf-8" }));
  a.download = exportName(title, "routing-grid.csv");
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Every stop's hold request, subject and body, in one paste. */
function CopyHolds({ plan }: { plan: Plan }) {
  const [done, setDone] = useState(false);
  if (!plan.stops.some((x) => x.pitch)) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(allHolds(plan)).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? "Holds copied" : "Copy all holds"}
    </button>
  );
}

function CopyLink() {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(location.href).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? "Link copied" : "Copy link"}
    </button>
  );
}
