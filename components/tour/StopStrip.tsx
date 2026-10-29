"use client";

import { useEffect, useRef, useState } from "react";
import type { Stop } from "@/lib/types";
import { shortDate, stopAnchor, stripCity } from "./display";
import s from "./tour.module.css";

/**
 * The tour book's stop strip: sticky under the poster for the rest of the page, one link per day sheet
 * ("5/6 Nashville", "5/15 SLC") and jumps to the model-alone comparison and the call sheet. The stop on screen is
 * marked. Where the stops don't fit (a phone, a narrow window, a long run) the strip scrolls sideways rather than
 * wrapping, its edge fades and an arrow says there is more.
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

  // Which edges have more to scroll to: the fade and the arrow follow them.
  const [edge, setEdge] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });
  const scroller = () => [list.current, row.current].find((el) => el && el.scrollWidth > el.clientWidth + 1) ?? null;
  useEffect(() => {
    const update = () => {
      const b = scroller();
      setEdge(b ? { start: b.scrollLeft > 2, end: b.scrollLeft + b.clientWidth < b.scrollWidth - 2 } : { start: false, end: false });
    };
    update();
    const els = [list.current, row.current].filter((e): e is NonNullable<typeof e> => !!e);
    els.forEach((el) => el.addEventListener("scroll", update, { passive: true }));
    window.addEventListener("resize", update);
    // Web fonts change the chips' widths after the first paint.
    void document.fonts?.ready.then(update);
    return () => {
      els.forEach((el) => el.removeEventListener("scroll", update));
      window.removeEventListener("resize", update);
    };
  }, []);
  const more = () => {
    const b = scroller();
    b?.scrollBy({ left: Math.max(120, b.clientWidth * 0.7), behavior: "smooth" });
  };
  const inStops = !!list.current && list.current === scroller();

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
    <nav className={s.strip} aria-label="Stops on this tour" data-start={edge.start && !inStops ? "" : undefined} data-end={edge.end && !inStops ? "" : undefined}>
      <div className={s.stripRow} ref={row}>
        <div className={s.stripStopsBox} data-start={edge.start && inStops ? "" : undefined} data-end={edge.end && inStops ? "" : undefined}>
        <ol className={s.stripStops} ref={list}>
          {stops.map((st, i) => {
            const id = stopAnchor(i);
            return (
              <li key={st.marketId}>
                <a href={`#${id}`} className={s.stripStop} aria-current={current === id ? "location" : undefined} title={stripCity(st.city) !== st.city ? st.label : undefined}>
                  <b className="num">{shortDate(st.date)}</b> {stripCity(st.city) !== st.city ? <abbr title={st.city} aria-label={st.city}>{stripCity(st.city)}</abbr> : st.city}
                </a>
              </li>
            );
          })}
        </ol>
        {edge.end && inStops && (
          <button type="button" className={s.stripMore} onClick={more} aria-label="More stops">
            →
          </button>
        )}
        </div>
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
      {edge.end && !inStops && (
        <button type="button" className={`${s.stripMore} ${s.stripMoreRow}`} onClick={more} aria-label="More of the strip">
          →
        </button>
      )}
    </nav>
  );
}
