"use client";

import { useEffect, useRef, useState } from "react";
import type { Stop } from "@/lib/types";
import { shortDate, stopAnchor } from "./display";
import s from "./tour.module.css";

/**
 * The tour book's stop strip: sticky under the poster for the rest of the page, one link per day sheet
 * ("5/6 Nashville") and jumps to the model-alone comparison and the call sheet. The stop on screen is marked, and
 * the strip scrolls sideways on a phone rather than wrapping.
 */
export function StopStrip({ stops, control, callSheet }: { stops: Stop[]; /** The page has the model-alone section. */ control: boolean; /** The page has the call sheet. */ callSheet: boolean }) {
  const [current, setCurrent] = useState<string | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const els = stops.map((_, i) => document.getElementById(stopAnchor(i))).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        // The first sheet in the reading band is the one being read.
        setCurrent(els.find((el) => seen.get(el.id))?.id ?? null);
      },
      { rootMargin: "-30% 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [stops]);

  // Keep the current stop in view inside the strip, without moving the page.
  useEffect(() => {
    // The stops scroll on their own on a wide screen and with the jumps on a phone (tour.module.css).
    const b = [list.current, row.current].find((el) => el && el.scrollWidth > el.clientWidth + 1);
    const a = current ? list.current?.querySelector<HTMLElement>(`a[href="#${current}"]`) : null;
    if (!b || !a) return;
    const left = a.getBoundingClientRect().left - b.getBoundingClientRect().left + b.scrollLeft - b.clientWidth / 2 + a.clientWidth / 2;
    b.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [current]);

  // A jump to the call sheet opens it.
  useEffect(() => {
    const open = () => {
      if (location.hash === "#call-sheet") (document.getElementById("call-sheet") as HTMLDetailsElement | null)?.setAttribute("open", "");
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  return (
    <nav className={s.strip} aria-label="Stops on this tour">
      <div className={s.stripRow} ref={row}>
        <ol className={s.stripStops} ref={list}>
          {stops.map((st, i) => {
            const id = stopAnchor(i);
            return (
              <li key={st.marketId}>
                <a href={`#${id}`} className={s.stripStop} aria-current={current === id ? "location" : undefined}>
                  <b className="num">{shortDate(st.date)}</b> {st.city}
                </a>
              </li>
            );
          })}
        </ol>
        {(control || callSheet) && <span className={s.stripSep} aria-hidden="true" />}
        {control && (
          <a href="#without-qloo" className={s.stripJump}>
            Without Qloo
          </a>
        )}
        {callSheet && (
          <a
            href="#call-sheet"
            className={s.stripJump}
            onClick={() => (document.getElementById("call-sheet") as HTMLDetailsElement | null)?.setAttribute("open", "")}
          >
            Call sheet
          </a>
        )}
      </div>
    </nav>
  );
}
