"use client";

import { useEffect, useRef } from "react";
import { readLine } from "@/lib/log";
import type { LogLine } from "@/lib/types";
import a from "./agent.module.css";
import s from "./tour.module.css";

const KIND: Record<LogLine["kind"], string> = { qloo: "Qloo", model: "Agent", rule: "Rule", web: "Web" };

/** Stored tours asked Qloo's weekly trend, which is flat for every artist on the hackathon host: not shown. */
const shown = (l: LogLine) => !(l.kind === "qloo" && /^Is this audience growing\?$/.test(l.text));

/**
 * The agent's call sheet: every question it put to Qloo (and the web, and its own rules) in plain words, with
 * what came back. While it runs, the newest line follows the eye; `full` adds the exact request under each line.
 * A revision round after check_plan shows each change as agent proposed → rule objected → agent re-chose.
 */
export function CallSheet({ log, running, full = false }: { log: LogLine[]; running: boolean; full?: boolean }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!running || !end.current) return;
    const box = end.current.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log.length, running]);

  return (
    <ol className={`${s.sheet} ${full ? s.sheetFull : ""}`} aria-live={running ? "polite" : undefined} aria-label="Agent call sheet">
      {log.filter(shown).map(readLine).map((l, i) => (
        <li key={i} className={`${s.call} ${s[l.kind]} ${l.failed ? s.callFailed : ""}`}>
          <span className={s.kind}>{KIND[l.kind]}</span>
          <div className={s.callBody}>
            <p className={s.q}>{l.text}</p>
            {l.result && <p className={s.a}>{l.result}</p>}
            {l.swaps && l.swaps.length > 0 && (
              <ul className={a.swaps} aria-label="What the agent changed after the check">
                {l.swaps.map((sw, j) => (
                  <li key={j} className={a.swap}>
                    <span>
                      <i>Agent proposed</i>
                      <span className={a.proposed}>{sw.proposed}</span>
                    </span>
                    <span>
                      <i>Rule objected</i>
                      <span className={a.objection}>{sw.objection}</span>
                    </span>
                    <span>
                      <i>Agent re-chose</i>
                      <span className={a.chose}>{sw.chose}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {full && l.request && <code className={s.req}>GET {l.request}</code>}
          </div>
          {l.ms !== undefined && <span className={`${s.ms} num`}>{l.ms < 1000 ? `${l.ms} ms` : `${(l.ms / 1000).toFixed(1)} s`}</span>}
        </li>
      ))}
      {running && (
        <li ref={end} className={`${s.call} ${s.working}`}>
          <span className={s.kind}>
            <i />
          </span>
          <div className={s.callBody}>
            <p className={s.q}>{log.length ? "Working on the next question…" : "Finding the artist on Qloo…"}</p>
          </div>
        </li>
      )}
    </ol>
  );
}
