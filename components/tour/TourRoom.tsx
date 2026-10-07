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
import { Campaign } from "./Campaign";
import { Control } from "./Control";
import s from "./tour.module.css";

type Event = { t: "log"; line: LogLine } | { t: "plan"; plan: Partial<Plan> } | { t: "done"; at: string; engine: TourRecord["engine"] } | { t: "error"; message: string };

const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * One tour: streams the agent's run when it's fresh (each Qloo call appears on the call sheet as it happens, the
 * poster fills in as the plan does), and shows the finished tour book on a revisit or a shared link.
 */
export function TourRoom({ initial }: { initial: TourRecord }) {
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

  async function stream() {
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

  async function poll() {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const r = await fetch(`/api/tours/${initial.id}`, { cache: "no-store" }).then((x) => x.json() as Promise<TourRecord>).catch(() => null);
      if (!r) continue;
      setRec(r);
      if (r.status === "done" || r.status === "failed") return;
    }
  }

  const plan = rec.plan;
  const poster = useMemo(() => (plan ? posterFor(plan) : null), [plan]);
  const running = rec.status === "queued" || rec.status === "running";
  const stops = plan?.stops ?? [];
  const title = plan?.artist?.name ?? rec.input.artist;

  return (
    <div className={`wrap ${s.room}`} data-status={rec.status}>
      <div className={s.top}>
        <div className={s.posterCol}>
          <div className={s.posterBox} ref={posterRef}>
            {poster ? <Poster {...poster} print={rec.status === "done" && initial.status !== "done"} /> : <div className={s.posterBlank}>{running ? "Reading the taste graph…" : "No poster"}</div>}
          </div>
          {rec.status === "done" && poster && (
            <div className={s.posterActions}>
              <button type="button" onClick={() => posterRef.current && downloadPoster(posterRef.current, `${title} ${season(plan!.firstDate)}`)}>
                Download poster
              </button>
              <CopyLink />
            </div>
          )}
        </div>

        <div className={s.head}>
          <p className={s.kicker}>{running ? "Routing now" : rec.status === "failed" ? "Routing stopped" : `Routed ${new Date(rec.finishedAt ?? rec.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}</p>
          <h1 className={s.title}>{title}</h1>
          {stops.length > 0 ? (
            <p className={s.summary}>
              <span className="num">{stops.length}</span> shows, {short(stops[0]!.date)} to {short(stops.at(-1)!.date)}, starting from {plan!.from.label}. About <span className="num">{plan!.totalKm.toLocaleString("en-US")}</span> km of road
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
              {rec.engine.writer ? `; pitches by ${rec.engine.writer}` : "; template pitches"}. Every Qloo call is listed at the end of the tour book.
            </p>
          )}
        </div>
      </div>

      {stops.length > 0 && (
        <section className={s.book} aria-labelledby="book-title">
          <h2 id="book-title" className={s.h2}>
            The tour book
          </h2>
          {plan!.audience?.advice && <p className={s.advice}>{plan!.audience.advice}</p>}
          <ol className={s.sheets}>
            {stops.map((st, i) => (
              <DaySheet key={st.marketId} stop={st} prev={i === 0 ? plan!.from.label.split(",")[0]! : stops[i - 1]!.city} total={plan!.cities.length} artist={title} pending={running} />
            ))}
          </ol>
        </section>
      )}

      {!running && plan?.guess && <Control plan={plan} agent={rec.engine?.agent} />}
      {!running && plan?.audience && <Campaign plan={plan} />}

      {!running && rec.log.length > 0 && (
        <details className={s.trace}>
          <summary>
            How the agent got here: {rec.log.filter((l) => l.kind === "qloo").length} Qloo calls, {rec.log.filter((l) => l.kind === "web").length} web lookups
          </summary>
          <CallSheet log={rec.log} running={false} full />
        </details>
      )}
    </div>
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
