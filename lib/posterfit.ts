/**
 * Setting the poster's wood type, kept pure so it is tested (test/poster.test.ts).
 *
 * A letterpress shop sets an artist's name to fill the block: each line at its own size, as wide as the column.
 * Type can be condensed a long way and still read as wood type; stretched wide it reads as a stretched picture
 * ("D.C." drawn four times its width, "MJ" as two slabs). So the fitter tries the name on one, two or three lines,
 * never leaves a line of four characters or fewer on its own, condenses as far as MIN_STRETCH, widens no further
 * than MAX_STRETCH, and when a short line still can't fill the column it is set smaller and centred instead.
 *
 * Widths are Big Shoulders' advances in ems (weight 900, display optical size, the poster's -0.005em tracking),
 * measured in Chromium on Oct 25, 2026; a character not in the table counts as an average capital.
 */

/** Advance widths of Big Shoulders 900 at display size, in ems, tracking included. */
const ADV: Record<string, number> = {
  A: 0.473, B: 0.468, C: 0.485, D: 0.49, E: 0.403, F: 0.401, G: 0.488, H: 0.48, I: 0.225, J: 0.448, K: 0.492, L: 0.397, M: 0.74,
  N: 0.538, O: 0.492, P: 0.466, Q: 0.492, R: 0.472, S: 0.469, T: 0.414, U: 0.482, V: 0.489, W: 0.795, X: 0.466, Y: 0.46, Z: 0.413,
  "0": 0.502, "1": 0.269, "2": 0.485, "3": 0.499, "4": 0.506, "5": 0.51, "6": 0.494, "7": 0.48, "8": 0.496, "9": 0.494,
  " ": 0.215, ".": 0.245, ",": 0.246, "'": 0.198, "’": 0.246, "&": 0.614, "-": 0.441, "!": 0.245, "?": 0.475, "/": 0.405, ":": 0.245,
  "+": 0.531, $: 0.469, "(": 0.287, ")": 0.287, '"': 0.398, Æ: 0.679, Œ: 0.676,
};
const AVG = 0.47;
/** Cap height of Big Shoulders, in ems. */
export const CAP = 0.8;
/** The narrowest wood type may be condensed to (Waxahatchee on one line sits at about 0.4). */
export const MIN_STRETCH = 0.38;
/** The widest it may be stretched: past this a short line is set smaller and centred, not drawn wider. */
export const MAX_STRETCH = 1.35;
/** A line this short or shorter is never split off on its own ("D.C.", "MJ", "XX", "LEG"). */
export const MIN_LINE = 4;
/** Space between two lines of wood type, baseline to the next cap top. */
const GAP = 10;

/** The width of a line at a font size of 1, in ems. Accents sit on their base letter's width. */
export function advance(text: string): number {
  let w = 0;
  for (const ch of text.normalize("NFD").replace(/[̀-ͯ]/g, "")) w += ADV[ch] ?? AVG;
  return w;
}

export type TitleBox = { x: number; top: number; bottom: number; width: number };
/** The poster's headline block: under the season line, above the rule at y 260, inside the 32-unit margins. */
export const TITLE_BOX: TitleBox = { x: 32, top: 64, bottom: 251, width: 476 };

export type TitleLine = {
  text: string;
  /** Font size, in poster units. */
  size: number;
  /** Baseline. */
  y: number;
  /** Where the line starts and how wide it is set (textLength): the column, or less, centred. */
  x: number;
  width: number;
  /** Horizontal scale against the natural width: below 1 condensed, above 1 widened (never past MAX_STRETCH). */
  stretch: number;
};

/** The ways to break a name into lines: whole, then every split at a space whose lines all run past MIN_LINE. */
export function breaks(name: string, maxLines = 3): string[][] {
  const words = name.toUpperCase().trim().split(/\s+/).filter(Boolean);
  const out: string[][] = [[words.join(" ")]];
  const split = (from: number, left: number, acc: string[]) => {
    for (let i = from + 1; i < words.length; i++) {
      const head = words.slice(from, i).join(" ");
      if (head.length <= MIN_LINE) continue;
      const rest = words.slice(i).join(" ");
      if (rest.length > MIN_LINE) out.push([...acc, head, rest]);
      if (left > 2) split(i, left - 1, [...acc, head]);
    }
  };
  if (maxLines > 1) split(0, maxLines, []);
  return out;
}

const CONNECTOR = /(^|\s)(&|AND|THE|OF|A|DE|LA|LE|Y|ET|UND)$/;

/** One way of setting the name, scored: ink in the block, less what condensing or widening costs the letters. */
function setLines(lines: string[], box: TitleBox): { lines: TitleLine[]; score: number } {
  const adv = lines.map(advance);
  const room = box.bottom - box.top - GAP * (lines.length - 1);
  // One stretch for every line, so they share a texture; each line's size then fills the column at that stretch.
  const ideal = (CAP * box.width * adv.reduce((n, a) => n + 1 / a, 0)) / room;
  const stretch = Math.min(MAX_STRETCH, Math.max(MIN_STRETCH, ideal));
  let sizes = adv.map((a) => box.width / (a * stretch));
  const tall = CAP * sizes.reduce((n, f) => n + f, 0);
  // Too tall even at the widest stretch: smaller type, narrower than the column, centred.
  const k = tall > room ? room / tall : 1;
  sizes = sizes.map((f) => f * k);
  const used = CAP * sizes.reduce((n, f) => n + f, 0) + GAP * (lines.length - 1);
  let y = box.top + (box.bottom - box.top - used) / 2;
  const set = lines.map((text, i) => {
    const size = sizes[i]!;
    const width = adv[i]! * size * stretch;
    y += CAP * size;
    const line = { text, size, y, x: box.x + (box.width - width) / 2, width, stretch };
    y += GAP;
    return line;
  });
  const ink = set.reduce((n, l) => n + l.width * CAP * l.size, 0) / (box.width * (box.bottom - box.top));
  const cost = stretch >= 1 ? 0.6 * Math.log(stretch) : 0.4 * Math.log(1 / stretch);
  const dangling = lines.slice(0, -1).filter((l) => CONNECTOR.test(l)).length * 0.04;
  // Lines of very different sizes read as a headline and a footnote, not one name.
  const uneven = 0.3 * Math.log(Math.max(...sizes) / Math.min(...sizes));
  return { lines: set, score: ink - cost - uneven - 0.02 * (lines.length - 1) - dangling };
}

/** Sets the artist's name in the headline block: the best of every allowed break. */
export function fitTitle(name: string, box: TitleBox = TITLE_BOX): TitleLine[] {
  let best: { lines: TitleLine[]; score: number } | null = null;
  for (const lines of breaks(name)) {
    const s = setLines(lines, box);
    if (!best || s.score > best.score + 1e-9) best = s;
  }
  return best!.lines;
}

/* The stamp: "FAN CITY No.3" over the city, inside a ring of radius 46 (stroke 3). */
export const STAMP_R = 44.5;
export const STAMP_BASELINE = 30;
/** Small-size Big Shoulders draws about 8% wider than the display cut the table measures. */
const SMALL_CUT = 1.08;
const STAMP_TRACK = 0.1;

/** The width the ring leaves for a line whose baseline sits at y below the centre, less a little air each side. */
export const chordAt = (y: number, r = STAMP_R, air = 3) => 2 * Math.sqrt(Math.max(0, r * r - y * y)) - 2 * air;

/** The stamp's city line: 12 units when it fits inside the ring, down to 10, then tighter tracking, then condensed
 *  to the chord ("SAN ANTONIO" once ran across the ring at 12). */
export function stampCity(city: string): { size: number; track: number; textLength?: number } {
  const t = city.toUpperCase();
  const room = chordAt(STAMP_BASELINE);
  const at = (size: number, track = STAMP_TRACK) => (advance(t) + track * t.length) * size * SMALL_CUT;
  if (at(12) <= room) return { size: 12, track: STAMP_TRACK };
  const size = Math.max(10, Math.floor(12 * (room / at(12)) * 2) / 2);
  if (at(size) <= room) return { size, track: STAMP_TRACK };
  const track = 0.03;
  return at(size, track) <= room ? { size, track } : { size, track, textLength: Math.floor(room) };
}

/** The band under the title: the support act once there is one, and an honest line until then. */
export const supportBand = (support?: string) => (support ? `WITH ${support.toUpperCase()}` : "SUPPORT TO BE ANNOUNCED");
