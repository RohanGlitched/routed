"use client";

import { useEffect, useRef, useState } from "react";
import type { Dot } from "@/lib/geo/map";
import s from "./poster.module.css";

/**
 * The tour poster, printed in two inks the way a letterpress shop would: the blue plate carries the halftone map
 * (each dot sized by Qloo fan affinity) and the type; the fire plate carries the artist, the route and the dates.
 * Where the inks cross they multiply to purple. It "prints" once when it first comes into view (blue plate,
 * then fire plate landing slightly out of register); with reduced motion it is simply there.
 */
export type PosterStop = { date: string; city: string; venue?: string };

export type PosterProps = {
  artist: string;
  season: string;
  region: string;
  dots: Dot[];
  route: [number, number][];
  start: [number, number] | null;
  stops: PosterStop[];
  topCity?: string;
  /** Print on first view. */
  print?: boolean;
  /** Smaller type for the wall. */
  compact?: boolean;
  label?: string;
};

const W = 540;
const H = 800;
const MAP_Y = 300;

/** Splits a name into one or two wood-type lines, balanced by length. */
export function woodLines(name: string): string[] {
  const t = name.toUpperCase().trim();
  if (t.length <= 11 || !t.includes(" ")) return [t];
  const words = t.split(/\s+/);
  let best = [t];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = [a, b];
    }
  }
  return best;
}

const fmt = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

export function Poster({ artist, season, region, dots, route, start, stops, topCity, print = false, compact = false, label }: PosterProps) {
  const ref = useRef<SVGSVGElement>(null);
  const [state, setState] = useState<"idle" | "printing" | "printed">(print ? "idle" : "printed");

  useEffect(() => {
    if (!print || state !== "idle") return;
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState("printed");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) {
          setState("printing");
          io.disconnect();
        }
      },
      { threshold: [0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [print, state]);

  const lines = woodLines(artist);
  const blockH = 196;
  const lineH = lines.length === 1 ? blockH : blockH / 2;
  const fontSize = lineH * 1.16;
  const rows = Math.max(1, Math.ceil(stops.length / 2));
  const datesTop = 566;
  const rowH = Math.min(40, (764 - datesTop) / rows);
  const colW = (W - 64 - 24) / 2;

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className={`${s.poster} ${s[state]}`} role="img" aria-label={label ?? `${artist} tour poster: ${stops.map((x) => `${fmt(x.date)} ${x.city}`).join(", ")}`}>
      <defs>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.43  0 0 0 0 0.4  0 0 0 0.2 0" />
        </filter>
      </defs>
      <rect width={W} height={H} fill="var(--poster-stock)" />

      {/* Blue plate */}
      <g className={s.blue} style={{ mixBlendMode: "multiply" }} fill="var(--blue)">
        <text x={32} y={46} className={s.topline}>
          {season.toUpperCase()}
        </text>
        <text x={W - 32} y={46} textAnchor="end" className={s.topline}>
          {region.toUpperCase()}
        </text>
        <rect x={32} y={260} width={W - 64} height={3} />
        <text x={W / 2} y={285} textAnchor="middle" className={s.band}>
          WITH SPECIAL GUESTS IN EVERY CITY
        </text>
        <rect x={32} y={294} width={W - 64} height={3} />
        <g transform={`translate(0 ${MAP_Y})`}>
          {dots.map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} />
          ))}
        </g>
        {stops.map((st, i) => {
          const col = i < rows ? 0 : 1;
          const row = i % rows;
          const x = 32 + col * (colW + 24);
          const y = datesTop + row * rowH;
          const tx = x + (compact ? 50 : 58);
          const room = colW - (tx - x) - 4;
          const cityFs = Math.min(20, rowH * 0.52);
          const venueFs = Math.min(11.5, rowH * 0.3);
          // Wood type is condensed, about half an em per capital: squeeze anything wider than its column.
          const squeeze = (text: string, fs: number, k: number) => (text.length * fs * k > room ? { textLength: room, lengthAdjust: "spacingAndGlyphs" as const } : {});
          return (
            <g key={`b${i}`}>
              <rect x={x} y={y} width={colW} height={2} />
              <text x={tx} y={y + rowH * 0.5 + 2} className={s.city} style={{ fontSize: cityFs }} {...squeeze(st.city, cityFs, 0.46)}>
                {st.city.toUpperCase()}
              </text>
              {st.venue && rowH >= 30 && (
                <text x={tx} y={y + rowH * 0.5 + 15} className={s.venue} style={{ fontSize: venueFs }} {...squeeze(st.venue, venueFs, 0.52)}>
                  {st.venue.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Fire plate, a hair out of register */}
      <g className={s.fire} style={{ mixBlendMode: "multiply" }} fill="var(--fire)">
        {lines.map((l, i) => (
          <text key={l} x={32} y={74 + lineH * (i + 1) - lineH * 0.06} className={s.wood} style={{ fontSize }} textLength={W - 64} lengthAdjust="spacingAndGlyphs">
            {l}
          </text>
        ))}
        <g transform={`translate(0 ${MAP_Y})`}>
          {route.length > 1 && <polyline points={route.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="var(--fire)" strokeWidth={3.4} strokeLinejoin="round" strokeLinecap="round" className={s.route} pathLength={1} />}
          {start && route.length > 0 && <line x1={start[0]} y1={start[1]} x2={route[0]![0]} y2={route[0]![1]} stroke="var(--fire)" strokeWidth={2} strokeDasharray="3 4" />}
          {route.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i === 0 ? 7.5 : 5} />
          ))}
        </g>
        {stops.map((st, i) => {
          const col = i < rows ? 0 : 1;
          const row = i % rows;
          const x = 32 + col * (colW + 24);
          const y = datesTop + row * rowH;
          return (
            <text key={`f${i}`} x={x} y={y + rowH * 0.5 + 2} className={s.date} style={{ fontSize: Math.min(20, rowH * 0.52) }}>
              {fmt(st.date)}
            </text>
          );
        })}
        {topCity && (
          <g transform={`translate(${W - 90} ${MAP_Y + 196}) rotate(-10)`} className={s.stamp}>
            <circle r={46} fill="none" stroke="var(--fire)" strokeWidth={3} />
            <text y={-17} textAnchor="middle" className={s.stampSmall}>
              FAN CITY
            </text>
            <text y={13} textAnchor="middle" className={s.stampBig}>
              NO.1
            </text>
            <text y={31} textAnchor="middle" className={s.stampSmall} textLength={topCity.length > 9 ? 70 : undefined} lengthAdjust="spacingAndGlyphs">
              {topCity.toUpperCase()}
            </text>
          </g>
        )}
        <rect x={32} y={770} width={W - 64} height={3} />
        <text x={32} y={789} className={s.foot}>
          ROUTED BY FAN AFFINITY
        </text>
        <text x={W - 32} y={789} textAnchor="end" className={s.foot}>
          QLOO TASTE GRAPH
        </text>
      </g>

      <rect width={W} height={H} filter="url(#grain)" style={{ mixBlendMode: "multiply" }} pointerEvents="none" />
    </svg>
  );
}
