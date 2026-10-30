import { localMap, localWords, readLocal, type LocalPlace } from "@/lib/geo/local";
import type { Local, Room, Spot } from "@/lib/types";
import { mapName, placeLabels, type MapLabel } from "./display";
import s from "./tour.module.css";

const SIZE = 260;
/** Spots labelled on the map besides the room: the nearest few to the fans' hottest blocks. */
const SPOTS = 3;

/** A round scale length near `km`: 0.5, 1, 2, 5 or 10 km. */
const niceKm = (km: number) => [0.5, 1, 2, 5, 10, 20].reduce((best, v) => (Math.abs(v - km) < Math.abs(best - km) ? v : best), 1);

/**
 * The city at street level, printed like the poster's map: each blue dot is a block of Qloo's heatmap sized by how
 * strongly the artist's fans over-index there; a dashed ring marks the hottest blocks and carries their
 * neighbourhood's name; the booked room is the fire mark, named; the other rooms these fans go to are small ink
 * dots, and a few of the poster shops and after-show bars are ink diamonds, named where a label fits. A scale line
 * says how wide the square is, and a legend says what each mark is. The words are read from the stop's own tiles
 * and places at render time (lib/geo/local.ts readLocal), so a tour saved under the old naming rule reads right
 * too: a neighbourhood is bold only when Qloo's places (or OpenStreetMap, credited) name it, and the room "sits in"
 * it only when Qloo files the room there.
 */
export function LocalMap({ local, room, others, city, artist, places, spots = [], size = SIZE, captionElsewhere = false }: { local: Local; room?: Room; others: Room[]; city: string; artist: string; /** Every Qloo place on the stop (rooms, poster shops, bars): they name the hottest blocks. */ places?: LocalPlace[]; /** Poster shops and after-show bars to mark on the map. */ spots?: Spot[]; size?: number; /** The page prints the caption under the city's name below 768px (LocalCaption), so the figure drops it there. */ captionElsewhere?: boolean }) {
  const placed = [room, ...others].filter((r): r is Room => r?.lat !== undefined && r?.lon !== undefined);
  const bookedRoom = room && placed[0] === room ? room : undefined;

  // Spots not already on the map as rooms, each once.
  const seen = new Set<string>([...(room ? [room.id, room.name] : []), ...others.map((o) => o.name)]);
  const fresh = spots.filter((p) => {
    if (p.lat === undefined || p.lon === undefined || seen.has(p.id) || seen.has(p.name)) return false;
    seen.add(p.id);
    seen.add(p.name);
    return true;
  });

  // One projection for everything, framed on the fans' core and the booked room (lib/geo/local.ts localMap).
  const pt = (r: { lat?: number; lon?: number }) => ({ lat: r.lat!, lon: r.lon! });
  const { dots, marks, scaleKm, hot } = localMap(local.tiles, [...placed.map(pt), ...fresh.map(pt)], size, { focus: bookedRoom ? [pt(bookedRoom)] : [] });
  if (!dots.length) return null;
  const inside = (m: { x: number; y: number }, pad = 4) => m.x > pad && m.x < size - pad && m.y > pad && m.y < size - pad;
  const roomMarks = marks.slice(0, placed.length);
  const booked = bookedRoom && inside(roomMarks[0]!) ? roomMarks[0] : undefined;
  const rest = roomMarks.slice(bookedRoom ? 1 : 0).filter((m) => inside(m));
  // The nearest few spots to the hottest blocks that fall inside the square, clear of the room's mark, the ring and
  // the scale line.
  const ringR = Math.round(size * 0.055);
  const clear = (m: { x: number; y: number }, c: { x: number; y: number } | undefined, r: number) => !c || Math.hypot(m.x - c.x, m.y - c.y) > r;
  const spotMarks = fresh
    .map((p, i) => ({ p, ...marks[placed.length + i]! }))
    .filter((m) => inside(m, 8) && clear(m, booked, 14) && clear(m, hot, ringR + 5) && !(m.y > size - 26 && m.x < size * 0.45))
    .sort((x, y) => (hot ? Math.hypot(x.x - hot.x, x.y - hot.y) - Math.hypot(y.x - hot.x, y.y - hot.y) : 0))
    .slice(0, SPOTS);

  const { read, osm, words } = mapReading(local, room, others, city, places);
  const aria = localWords(read, city, `${artist} fans`);
  const label = `${aria.lead}${aria.name ?? ""}${aria.tail} ${aria.verdict}`.trim();

  const bar = niceKm(scaleKm / 4);
  const barPx = (bar / scaleKm) * size;
  const areaName = read.area;

  // Labels in order of importance: the room, the neighbourhood, then the spots, each clear of the marks and the
  // labels already placed; one that can't fit is left off rather than printed over another.
  const fs = { room: 11, area: 11.5, spot: 9.5 } as const;
  const box = (x: number, y: number, r: number): MapLabel["box"] => [x - r, y - r, x + r, y + r];
  const scaleBox: MapLabel["box"] = [0, size - 20, 34 + barPx, size];
  const bookedBox = booked ? [box(booked.x, booked.y, 8)] : [];
  const hotBox = hot ? [box(hot.x, hot.y, ringR)] : [];
  // Every mark is kept clear too, so no label sits on another room's dot or a spot's diamond (Oct 30: "The Bow Tie
  // Cafe" printed over a dot).
  const restBoxes = rest.map((m) => box(m.x, m.y, 4));
  const spotBox = (m: { x: number; y: number }) => box(m.x, m.y, 5);
  const want = [
    ...(booked && room ? [{ text: mapName(room.name, 24), x: booked.x, y: booked.y, gap: 10, kind: "room" as const, avoid: [scaleBox, ...restBoxes, ...spotMarks.map(spotBox)] }] : []),
    ...(hot ? [{ text: areaName ? mapName(areaName, 24) : "Hottest blocks", x: hot.x, y: hot.y, gap: ringR + 4, kind: "area" as const, avoid: [scaleBox, ...bookedBox, ...restBoxes, ...spotMarks.map(spotBox)] }] : []),
    ...spotMarks.map((m) => ({ text: mapName(m.p.name, 18), x: m.x, y: m.y, gap: 7, kind: "spot" as const, avoid: [scaleBox, ...bookedBox, ...hotBox, ...restBoxes, ...spotMarks.filter((o) => o !== m).map(spotBox)] })),
  ];
  // Each label also keeps off the fans' dots where it can (Oct 30: "Voltage Records" and "The Orange Peel" sat on
  // dots on the deck's day slide): first clear of every dot, then of the larger ones, then over dots with its halo.
  const dotTiers = [dots.map((d) => box(d.x, d.y, d.r + 1)), dots.filter((d) => d.r >= 3).map((d) => box(d.x, d.y, d.r)), []];
  const placedLabels: (MapLabel & { kind: keyof typeof fs })[] = [];
  for (const w of want) {
    let l: MapLabel | null = null;
    for (const tier of dotTiers) {
      [l] = placeLabels([w], size, fs[w.kind], [...w.avoid, ...tier, ...placedLabels.map((p) => p.box)]);
      if (l) break;
    }
    if (l) placedLabels.push({ ...l, kind: w.kind });
  }

  return (
    <figure className={s.local}>
      <svg viewBox={`0 0 ${size} ${size}`} className={s.localSvg} role="img" aria-label={label}>
        <rect x="0" y="0" width={size} height={size} fill="var(--poster-stock)" />
        <g fill="var(--blue)" style={{ mixBlendMode: "multiply" }} opacity="0.8">
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} />
          ))}
        </g>
        {hot && <circle cx={hot.x} cy={hot.y} r={ringR} fill="none" stroke="var(--blue-deep)" strokeWidth="1.5" strokeDasharray="3 3" />}
        <g fill="var(--ink)">
          {rest.map((m, i) => (
            <circle key={i} cx={m.x} cy={m.y} r="2.6" />
          ))}
        </g>
        <g fill="var(--poster-stock)" stroke="var(--ink)" strokeWidth="1.6">
          {spotMarks.map((m) => (
            <rect key={m.p.id} x={m.x - 3} y={m.y - 3} width="6" height="6" transform={`rotate(45 ${m.x} ${m.y})`} />
          ))}
        </g>
        {booked && (
          <g>
            <circle cx={booked.x} cy={booked.y} r="7" fill="none" stroke="var(--fire)" strokeWidth="2.5" />
            <circle cx={booked.x} cy={booked.y} r="2.6" fill="var(--fire)" />
          </g>
        )}
        <g className={s.localLabels}>
          {placedLabels.map((l) => (
            <text key={`${l.kind}${l.text}`} x={l.x} y={l.y} textAnchor={l.anchor} className={l.kind === "room" ? s.labelRoom : l.kind === "area" ? s.labelArea : s.labelSpot} style={{ fontSize: fs[l.kind] }}>
              {l.text}
            </text>
          ))}
        </g>
        <g stroke="var(--ink)" strokeWidth="1.5">
          <line x1={8} x2={8 + barPx} y1={size - 9} y2={size - 9} />
          <line x1={8} x2={8} y1={size - 13} y2={size - 5} />
          <line x1={8 + barPx} x2={8 + barPx} y1={size - 13} y2={size - 5} />
        </g>
        <text x={12 + barPx} y={size - 6} className={s.localScale}>
          {bar} km
        </text>
      </svg>
      <ul className={s.legend} aria-label="Map key">
        <li>
          <svg viewBox="0 0 30 12" width="30" height="12" aria-hidden="true">
            <g fill="var(--blue)" opacity="0.8">
              <circle cx="3" cy="6" r="1.6" />
              <circle cx="11" cy="6" r="3" />
              <circle cx="23" cy="6" r="5" />
            </g>
          </svg>
          Fans over-index: more where larger
        </li>
        {booked && (
          <li>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <circle cx="6" cy="6" r="4.4" fill="none" stroke="var(--fire)" strokeWidth="2" />
              <circle cx="6" cy="6" r="1.6" fill="var(--fire)" />
            </svg>
            The booked room
          </li>
        )}
        {hot && (
          <li>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <circle cx="6" cy="6" r="4.6" fill="none" stroke="var(--blue-deep)" strokeWidth="1.4" strokeDasharray="2 2" />
            </svg>
            The hottest blocks
          </li>
        )}
        {rest.length > 0 && (
          <li>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <circle cx="6" cy="6" r="2.4" fill="var(--ink)" />
            </svg>
            Other rooms
          </li>
        )}
        {spotMarks.length > 0 && (
          <li>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <rect x="3.5" y="3.5" width="5" height="5" transform="rotate(45 6 6)" fill="var(--poster-stock)" stroke="var(--ink)" strokeWidth="1.4" />
            </svg>
            Poster and after-show spots
          </li>
        )}
      </ul>
      <figcaption className={captionElsewhere ? s.captionWide : undefined}>
        <CaptionText words={words} osm={osm} />
      </figcaption>
    </figure>
  );
}

/** The map's reading: the fans' hottest blocks, named, and how far the room sits from them (lib/geo/local.ts). */
function mapReading(local: Local, room: Room | undefined, others: Room[], city: string, places?: LocalPlace[]) {
  // A neighbourhood named from OpenStreetMap (when Qloo's places there name none) is settled at run time like the
  // Qloo vote, and credited under the map.
  const osm = (local.hot as { named?: string }).named === "osm" && !!local.hot.name;
  const settled: Local = osm ? { ...local, hot: { ...local.hot, named: "near" } } : local;
  const read = readLocal(settled, room, places ?? [room, ...others].filter((r): r is Room => !!r));
  return { read, osm, words: localWords(read, city) };
}

function CaptionText({ words, osm }: { words: ReturnType<typeof localWords>; osm: boolean }) {
  return (
    <>
      {words.lead}
      {words.name && <b>{words.name}</b>}
      {words.tail}
      {words.verdict ? ` ${words.verdict}` : ""}
      {osm && (
        <span className={s.credit}>
          {" "}
          Neighbourhood name from OpenStreetMap,{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            © OpenStreetMap contributors
          </a>
          .
        </span>
      )}
    </>
  );
}

/** The map's one-line reading on its own, for a phone's day sheet, where it prints under the city's name. */
export function LocalCaption({ local, room, others, city, places, className }: { local: Local; room?: Room; others: Room[]; city: string; places?: LocalPlace[]; className?: string }) {
  const { osm, words } = mapReading(local, room, others, city, places);
  return (
    <p className={className}>
      <CaptionText words={words} osm={osm} />
    </p>
  );
}
