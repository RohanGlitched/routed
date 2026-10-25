import { localMap, localWords, readLocal, type LocalPlace } from "@/lib/geo/local";
import type { Local, Room } from "@/lib/types";
import s from "./tour.module.css";

const SIZE = 180;

/**
 * The city at street level, printed like the poster's map: each blue dot is a Qloo heatmap tile (about 150 m)
 * sized by how strongly the artist's fans over-index there; the booked room is the fire mark, the other rooms
 * these fans go to are small ink marks. A scale line says how wide the square is. The words are read from the
 * stop's own tiles and places at render time (lib/geo/local.ts readLocal), so a tour saved under the old naming
 * rule reads right too: a neighbourhood is bold only when Qloo's places name it, and the room "sits in" it only
 * when Qloo files the room there.
 */
export function LocalMap({ local, room, others, city, artist, places }: { local: Local; room?: Room; others: Room[]; city: string; artist: string; /** Every Qloo place on the stop (rooms, poster shops, bars): they name the hottest blocks. */ places?: LocalPlace[] }) {
  const placed = [room, ...others].filter((r): r is Room => r?.lat !== undefined && r?.lon !== undefined);
  const { dots, marks, scaleKm } = localMap(local.tiles, placed.map((r) => ({ lat: r.lat!, lon: r.lon! })), SIZE);
  if (!dots.length) return null;
  const booked = room && placed[0] === room ? marks[0] : undefined;
  const rest = marks.slice(booked ? 1 : 0);
  const read = readLocal(local, room, places ?? [room, ...others].filter((r): r is Room => !!r));
  const words = localWords(read, city);
  const aria = localWords(read, city, `${artist} fans`);
  const label = `${aria.lead}${aria.name ?? ""}${aria.tail} ${aria.verdict}`.trim();
  const bar = Math.max(1, Math.round(scaleKm / 4));
  const barPx = (bar / scaleKm) * SIZE;
  return (
    <figure className={s.local}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={s.localSvg} role="img" aria-label={label}>
        <rect x="0" y="0" width={SIZE} height={SIZE} fill="var(--poster-stock)" />
        <g fill="var(--blue)" style={{ mixBlendMode: "multiply" }} opacity="0.85">
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} />
          ))}
        </g>
        <g fill="var(--ink)">
          {rest.map((m, i) => (
            <circle key={i} cx={m.x} cy={m.y} r="2.6" />
          ))}
        </g>
        {booked && (
          <g>
            <circle cx={booked.x} cy={booked.y} r="7" fill="none" stroke="var(--fire)" strokeWidth="2.5" />
            <circle cx={booked.x} cy={booked.y} r="2.6" fill="var(--fire)" />
          </g>
        )}
        <g stroke="var(--ink)" strokeWidth="1.5">
          <line x1={8} x2={8 + barPx} y1={SIZE - 9} y2={SIZE - 9} />
          <line x1={8} x2={8} y1={SIZE - 13} y2={SIZE - 5} />
          <line x1={8 + barPx} x2={8 + barPx} y1={SIZE - 13} y2={SIZE - 5} />
        </g>
        <text x={12 + barPx} y={SIZE - 6} className={s.localScale}>
          {bar} km
        </text>
      </svg>
      <figcaption>
        {words.lead}
        {words.name && <b>{words.name}</b>}
        {words.tail}
        {words.verdict ? ` ${words.verdict}` : ""}
      </figcaption>
    </figure>
  );
}
