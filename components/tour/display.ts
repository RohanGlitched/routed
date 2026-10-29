import type { LogLine, Room, TourRecord } from "@/lib/types";

/**
 * Pure helpers for the tour book's display (no React), tested in test/display.test.ts: the stop strip's labels,
 * a guard on room capacities a room of that kind can't have, the call-sheet counts the page prints, and where the
 * street-level map's labels can go without covering each other.
 */

/** "5/6", as the poster prints a date. */
export const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

/** A stop as the stop strip names it: "5/6 Nashville". */
export const stripLabel = (s: { date: string; city: string }) => `${shortDate(s.date)} ${s.city}`;

/** The day sheet's anchor: stops count from 1, as the poster's rows do. */
export const stopAnchor = (i: number) => `stop-${i + 1}`;

/** Names that say the room is built for big crowds: no ceiling from the name. */
const BIG = /amphithe|arena|stadium|pavilion|\bcent(er|re)\b|\bpark\b|\bfield\b|\bbowl\b|fairground|coliseum|colosseum|\bdome\b|garden|speedway|racecourse|showground|\bforum\b/i;
/** Theatres, halls, auditoriums, ballrooms: none holds 10,000. */
const HALL = /theat(er|re)|\bhall\b|auditori|\bopera\b|playhouse|ballroom|\bchurch\b|\bchapel\b|cathedral/i;
/** Clubs, bars, rooms: none holds 3,000. */
const CLUB = /\bclub\b|\bbar\b|tavern|lounge|\bpub\b|caf[eé]|saloon|cellar|basement|\broom\b|studio|\bden\b|\bcave\b/i;

/** The most people a room of this kind can hold, read from its name; undefined when the name doesn't say. */
export function capacityCeiling(name: string): number | undefined {
  if (BIG.test(name)) return undefined;
  if (HALL.test(name)) return 10_000;
  if (CLUB.test(name)) return 3_000;
  return undefined;
}

/**
 * The capacity the day sheet may print for a room: none when the figure is impossible for the kind of room its
 * name says it is (a "Madison Theater" holding 17,556 is a stadium figure that slipped through a lookup).
 */
export function shownCapacity(room: Pick<Room, "name" | "capacity">): Room["capacity"] | undefined {
  const c = room.capacity;
  if (!c || !(c.value > 0)) return undefined;
  const cap = capacityCeiling(room.name);
  return cap !== undefined && c.value > cap ? undefined : c;
}

/** "Bogart's (holds 1,200)", "Musicians Corner (fan affinity 92)": every aside says what its number is. */
export function otherRoomLabel(r: Pick<Room, "name" | "capacity" | "affinity">): string {
  const c = shownCapacity(r);
  if (c) return `${r.name} (holds ${c.value.toLocaleString("en-US")})`;
  if (r.affinity !== undefined) return `${r.name} (fan affinity ${Math.round(r.affinity * 100)})`;
  return r.name;
}

/** Stored tours asked Qloo's weekly trend, which is flat for every artist on the hackathon host: not shown. */
export const shownLine = (l: LogLine) => !(l.kind === "qloo" && /^Is this audience growing\?$/.test(l.text));

/**
 * What the call sheet holds, by kind, as the footer counts it: lines shown, and of the Qloo lines how many carry
 * their exact request. The run's own tally (engine.usage.qloo) counts every request sent to Qloo, including the
 * place searches by name that a single line sums up, so it is the larger number.
 */
export function sheetCounts(log: LogLine[]): { qloo: number; withRequest: number; model: number; rule: number; web: number } {
  const shown = log.filter(shownLine);
  const q = shown.filter((l) => l.kind === "qloo");
  return {
    qloo: q.length,
    withRequest: q.filter((l) => l.request).length,
    model: shown.filter((l) => l.kind === "model").length,
    rule: shown.filter((l) => l.kind === "rule").length,
    web: shown.filter((l) => l.kind === "web").length,
  };
}

/** How the rules and the agent settled the booking, in one sentence (the counts /proof can total). */
export function checkLine(c: NonNullable<NonNullable<TourRecord["engine"]>["check"]>): string {
  const obj = (n: number) => `${n} objection${n === 1 ? "" : "s"}`;
  const first = c.before ? `The rules raised ${obj(c.before)} to the agent's booking${c.rounds ? `; it re-booked ${c.revised} pick${c.revised === 1 ? "" : "s"} in ${c.rounds} round${c.rounds === 1 ? "" : "s"}, leaving ${c.after ? obj(c.after) : "none"}` : ""}.` : "The agent's booking cleared every rule.";
  return `${first} ${c.ruled ? `A rule still changed ${c.ruled} of ${c.stops} stops.` : `Every stop is the agent's own.`}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/* ───────────── labels on the street-level map ───────────── */

export type MapLabel = { text: string; x: number; y: number; anchor: "start" | "end" | "middle"; box: [x0: number, y0: number, x1: number, y1: number] };

/**
 * Places each label beside its point (right, left, above, below, in that order) where it stays inside the square
 * and clear of the labels already placed and of `avoid` boxes; a label that fits nowhere is left out rather than
 * printed over another. Width is estimated from the text at `fs` px (Schibsted Grotesk runs about 0.56 em a letter).
 */
export function placeLabels(items: { text: string; x: number; y: number; gap?: number }[], size: number, fs = 10, avoid: MapLabel["box"][] = []): (MapLabel | null)[] {
  const taken: MapLabel["box"][] = [...avoid];
  const hit = (a: MapLabel["box"], b: MapLabel["box"]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  return items.map(({ text, x, y, gap = 6 }) => {
    const w = text.length * fs * 0.56;
    const h = fs * 1.2;
    const tries: MapLabel[] = [
      { text, x: x + gap, y: y + fs * 0.35, anchor: "start", box: [x + gap - 2, y - h / 2, x + gap + w + 2, y + h / 2] },
      { text, x: x - gap, y: y + fs * 0.35, anchor: "end", box: [x - gap - w - 2, y - h / 2, x - gap + 2, y + h / 2] },
      { text, x, y: y - gap - 2, anchor: "middle", box: [x - w / 2 - 2, y - gap - 2 - h, x + w / 2 + 2, y - gap + 1] },
      { text, x, y: y + gap + fs, anchor: "middle", box: [x - w / 2 - 2, y + gap - 1, x + w / 2 + 2, y + gap + fs + 3] },
    ];
    const ok = tries.find((t) => t.box[0] >= 2 && t.box[1] >= 2 && t.box[2] <= size - 2 && t.box[3] <= size - 2 && !taken.some((b) => hit(b, t.box)));
    if (!ok) return null;
    taken.push(ok.box);
    return ok;
  });
}

/** A label short enough for the map: the name up to its first comma or bracket, cut at a word near `max`. */
export function mapName(name: string, max = 22): string {
  const n = name.split(/[,(]/)[0]!.trim();
  if (n.length <= max) return n;
  const cut = n.slice(0, max + 1).replace(/\s+\S*$/, "");
  return `${(cut.length >= 6 ? cut : n.slice(0, max)).trim()}…`;
}
