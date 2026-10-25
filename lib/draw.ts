/**
 * A usual crowd to assume when the visitor leaves "Usual crowd" at "Not sure", from the artist's Qloo popularity
 * (a percentile across every artist Qloo knows, so most touring acts sit above 0.9 and the bands are narrow up
 * there). Each band lands on a value the crowd dropdown offers, so "change it" opens the form on a real option.
 *
 * Checked against the tours routed so far, with the crowd their managers would give: Wednesday 0.955 → 1,000
 * (plays about 800), Black Pumas 0.970 → 1,500 (1,200 to 1,500 theatres), Wet Leg 0.977 → 1,500 (about 2,000),
 * Fontaines D.C. 0.989 → 2,500 (about 3,000), Japanese Breakfast and Big Thief 0.991 → 2,500 (1,500 to 2,500),
 * Ghost 0.995 → 4,000 (arenas of 8,000). It is a guess and says so: it errs low for the biggest acts (Zach Bryan
 * reads 0.971 and plays stadiums), which is why the tour book prints "Assumed about N; change it".
 */
export const CROWD_OPTIONS = [150, 300, 600, 1000, 1500, 2500, 4000, 7000, 12000, 15000, 25000] as const;

const BANDS: [minPopularity: number, draw: number][] = [
  [0.999, 12000],
  [0.997, 7000],
  [0.993, 4000],
  [0.985, 2500],
  [0.97, 1500],
  [0.95, 1000],
  [0.9, 600],
  [0.8, 300],
];

/** The crowd to assume for an artist's Qloo popularity (0–1), or undefined when Qloo gave none. */
export function assumeDraw(popularity: number | undefined): number | undefined {
  if (popularity === undefined || !Number.isFinite(popularity)) return undefined;
  for (const [min, draw] of BANDS) if (popularity >= min) return draw;
  return 150;
}
