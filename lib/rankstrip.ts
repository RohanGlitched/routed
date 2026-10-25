/**
 * The rank strip on a tour page (components/tour/Control.tsx), laid out here so it is tested: two rows of dots
 * (Routed, the model alone) over one fan-map rank axis, with the tick labels under their own baseline where no dot
 * can cover them. The axis is logarithmic, so #1 to #10 takes about half the width and a tour of strong cities
 * (#2 to #12) reads city by city instead of as one blob. Dots that would touch are stacked within their row, and
 * each row labels as many cities as fit, best first for Routed and worst first for the model alone.
 */

export type StripCity = { name: string; rank?: number };
export type StripDot = { name: string; rank?: number; x: number; y: number; label?: { x: number; y: number; text: string; /** Leader from the dot to the label's row. */ y1: number; y2: number } };
export type Strip = {
  W: number;
  H: number;
  cap: number;
  axis: { x1: number; x2: number; y: number };
  ticks: { x: number; label: string }[];
  /** Where cities that aren't on the fan map at all sit, past the end of the axis. */
  off?: { x: number; label: string };
  rows: { name: string; y: number; dots: StripDot[] }[];
};

export const STRIP_W = 760;
const LEFT = 118;
const RIGHT = 18;
const OFF_W = 96;
export const DOT_R = 6;
const STEP = 2 * DOT_R + 1;
/** Rough width of one character of the 12-unit label type (Schibsted Grotesk 600). */
const CHAR = 6.6;
const NICE = [10, 20, 50, 100, 200, 500, 1000, 2000];
const TICKS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/** x for a rank on a log axis from #1 to #cap. */
// Rounded so the server's and the browser's Math.log can't disagree in the last digit (a hydration mismatch).
export const rankX = (rank: number, cap: number, x1: number, x2: number) =>
  Math.round((x1 + (Math.log(Math.min(Math.max(rank, 1), cap)) / Math.log(Math.max(cap, 2))) * (x2 - x1)) * 100) / 100;

/** Vertical offsets that keep dots in one row from touching: each dot takes the nearest free level. */
export function stack(xs: number[], levels = [0, -1, 1]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const placed: { x: number; dy: number }[] = [];
  const out = new Array<number>(xs.length).fill(0);
  for (const [x, i] of order) {
    const room = (d: number) => Math.min(Infinity, ...placed.map((p) => Math.hypot(p.x - x, p.dy - d)));
    const ds = levels.map((l) => l * STEP);
    // The first level where the dot touches nothing; when every level is taken, the one with the most room.
    const dy = ds.find((d) => room(d) >= STEP - 0.01) ?? ds.reduce((a, b) => (room(b) > room(a) ? b : a));
    placed.push({ x, dy });
    out[i] = dy;
  }
  return out;
}

/** Labels in priority order, each in the first of the given rows (nearest the dots first) where it overlaps no
 *  label already set and its leader to the dot crosses no label in a nearer row. */
export function placeLabels(items: { x: number; text: string }[], rows: number[], minX: number, maxX: number): ({ x: number; y: number; row: number } | null)[] {
  const taken = rows.map(() => [] as [number, number][]);
  const leaders: { x: number; row: number }[] = [];
  return items.map(({ x, text }) => {
    const w = text.length * CHAR;
    const cx = Math.min(Math.max(x, minX + w / 2), maxX - w / 2);
    const span: [number, number] = [cx - w / 2 - 6, cx + w / 2 + 6];
    const free = (t: [number, number][]) => t.every(([a, b]) => span[1] <= a || span[0] >= b);
    const clear = (t: [number, number][]) => t.every(([a, b]) => x <= a || x >= b);
    const r = taken.findIndex((t, i) => free(t) && taken.slice(0, i).every(clear) && leaders.every((l) => l.row <= i || x === l.x || l.x <= span[0] || l.x >= span[1]));
    if (r < 0) return null;
    taken[r]!.push(span);
    leaders.push({ x, row: r });
    return { x: cx, y: rows[r]!, row: r };
  });
}

/** The whole strip: axis, ticks, the two rows, their stacking and labels. `n` is how many cities the fan map ranks. */
export function layoutStrip(ours: StripCity[], theirs: StripCity[], n: number): Strip {
  const ranks = [...ours, ...theirs].map((c) => c.rank ?? 0);
  const worst = Math.max(10, ...ranks);
  const cap = Math.max(2, Math.min(n, NICE.find((t) => t >= worst) ?? worst));
  const hasOff = theirs.some((t) => !t.rank) || ours.some((o) => !o.rank);
  const x1 = LEFT;
  const x2 = STRIP_W - RIGHT - (hasOff ? OFF_W : 0);
  const x = (r: number) => rankX(r, cap, x1, x2);
  const endLabel = `#${cap}`;
  const ticks = TICKS.filter((t) => t < cap && x(cap) - x(t) > 34).map((t) => ({ x: x(t), label: `#${t}` }));
  ticks.push({ x: x(cap), label: endLabel });
  const off = hasOff ? { x: STRIP_W - 36, label: "Off the map" } : undefined;
  const xOf = (c: StripCity) => (c.rank ? x(c.rank) : off!.x);

  // Labels name the city; the axis and the tooltip carry the rank, and an unranked pick sits past the axis.
  const row = (cities: StripCity[], y: number, labelRows: number[], bestFirst: boolean) => {
    const above = labelRows[0]! < y;
    const xs = cities.map(xOf);
    const dys = stack(xs);
    const order = cities.map((_, i) => i).sort((a, b) => (bestFirst ? 1 : -1) * ((cities[a]!.rank ?? 1e9) - (cities[b]!.rank ?? 1e9)));
    const text = (c: StripCity) => c.name;
    const spots = placeLabels(order.map((i) => ({ x: xs[i]!, text: text(cities[i]!) })), labelRows, x1 - 8, STRIP_W);
    const label = new Map(order.map((i, k) => [i, spots[k]]));
    return cities.map((c, i): StripDot => {
      const at = label.get(i);
      const dy = y + dys[i]!;
      const lead = at ? (above ? { y1: dy - DOT_R - 2, y2: at.y + 4 } : { y1: dy + DOT_R + 2, y2: at.y - 12 }) : null;
      return { name: c.name, rank: c.rank, x: xs[i]!, y: dy, ...(at && lead ? { label: { x: at.x, y: at.y, text: text(c), ...lead } } : {}) };
    });
  };

  return {
    W: STRIP_W,
    H: 190,
    cap,
    axis: { x1, x2: hasOff ? x2 : x(cap), y: 160 },
    ticks,
    off,
    rows: [
      { name: "Routed", y: 54, dots: row(ours, 54, [29, 14], true) },
      { name: "Model alone", y: 100, dots: row(theirs, 100, [134, 149], false) },
    ],
  };
}
