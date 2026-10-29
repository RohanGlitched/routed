"use client";

import type { Dot } from "@/lib/geo/map";
import { fitTitle, stampCity, STAMP_BASELINE, supportBand } from "@/lib/posterfit";
import s from "./poster.module.css";

/**
 * The tour poster, printed in two inks the way a letterpress shop would: the blue plate carries the halftone map
 * (each dot sized by Qloo fan affinity) and the type; the fire plate carries the artist, the route and the dates.
 * Where the inks cross they multiply to purple. On a wide screen it "prints" once as the page paints (blue plate,
 * then fire plate landing slightly out of register); on a phone or with reduced motion it is simply there.
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
  /** The stamped city's rank on the artist's fan map (the strongest city on this tour isn't always #1). */
  topRank?: number;
  /** The support act on every date, printed under the rule; older tours had one per city. */
  support?: string;
  /** Print once as it first paints (wide screens, motion allowed); otherwise drawn printed. */
  print?: boolean;
  /** Smaller type for the wall. */
  compact?: boolean;
  label?: string;
};

const W = 540;
const H = 800;
const MAP_Y = 300;

const fmt = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

export function Poster({ artist, season, region, dots, route, start, stops, topCity, topRank = 1, support, print = false, compact = false, label }: PosterProps) {
  // The print runs in CSS from the first paint (poster.module.css .press), so the server's HTML is never a blank
  // sheet waiting for hydration; at phone width or with reduced motion the poster is simply printed.
  const state = print ? "press" : "printed";

  // Wood type set to fill the block without stretching a short line into slabs (lib/posterfit.ts).
  const title = fitTitle(artist);
  const stamp = topCity ? stampCity(topCity) : null;
  const rows = Math.max(1, Math.ceil(stops.length / 2));
  const datesTop = 566;
  const rowH = Math.min(40, (764 - datesTop) / rows);
  const colW = (W - 64 - 24) / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`${s.poster} ${s[state]}`} role="img" aria-label={label ?? `${artist} tour poster: ${stops.map((x) => `${fmt(x.date)} ${x.city}`).join(", ")}`}>
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
        <text x={W / 2} y={285} textAnchor="middle" className={s.band} {...(support && support.length > 28 ? { textLength: W - 80, lengthAdjust: "spacingAndGlyphs" as const } : {})}>
          {supportBand(support)}
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
        {title.map((l) => (
          <text key={l.text} x={l.x} y={l.y} className={s.wood} style={{ fontSize: l.size }} textLength={l.width} lengthAdjust="spacingAndGlyphs">
            {l.text}
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
        {topCity && stamp && (
          <g transform={`translate(${W - 90} ${MAP_Y + 196}) rotate(-10)`} className={s.stamp}>
            <circle r={46} fill="none" stroke="var(--fire)" strokeWidth={3} />
            <text y={-17} textAnchor="middle" className={s.stampSmall}>
              FAN CITY
            </text>
            <text y={13} textAnchor="middle" className={s.stampBig}>
              NO.{topRank}
            </text>
            <text y={STAMP_BASELINE} textAnchor="middle" className={s.stampSmall} style={{ fontSize: stamp.size, letterSpacing: `${stamp.track}em` }} {...(stamp.textLength ? { textLength: stamp.textLength, lengthAdjust: "spacingAndGlyphs" as const } : {})}>
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
