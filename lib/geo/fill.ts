import { km } from "./markets";
import { addDays, radiusFor, roadKm, SHOW_DAY_DRIVE_H, travel, TRAVEL_DAY_DRIVE_H, type RADIUS_BY_REGION } from "./route";

/**
 * Fill dates: what a booker does with the dark days on a long leg. For each leg with travel days or a day off
 * before the next show, the cities already on the artist's Qloo fan map (plan.cities, so no new call) that sit on
 * the way: the band can drive there and play a dark day, then still make the next show on its date under the same
 * drive rules the route uses (8 h on a show day, 11 h on a travel day). The tour's stops never change; these are
 * options printed beside it.
 *
 * Pure: the plan's stops and fan map in, the options out (test/fill.test.ts).
 */

type Pt = { lat: number; lon: number; marketId?: string };
export type FillCity = Pt & { marketId: string; name: string; label?: string; rank: number };
export type FillStop = Pt & { marketId: string; city: string; date: string; nights?: number; travelDays: number; dayOff: boolean };

export type FillOption = {
  marketId: string;
  city: string;
  /** The city's place on the artist's Qloo fan map (1 = strongest). */
  fanRank: number;
  /** Road km the stop adds to the drive between the two shows. */
  addedKm: number;
  /** Road km and door-to-door hours from the show before. */
  fromKm: number;
  fromHours: number;
  /** The dark day it could play. */
  date: string;
  /** A room this tour's own data already names in the city (the model-alone tour's pick, found on Qloo); none
   *  means the room is still to find. */
  room?: string;
};

export type FillLeg = {
  /** Index of the stop after the gap (the day sheet that prints the options). */
  index: number;
  from: string;
  to: string;
  km: number;
  hours: number;
  travelDays: number;
  dayOff: boolean;
  /** The dark days between the two shows, in order. */
  dark: string[];
  options: FillOption[];
};

/** At most this many options a leg. */
export const FILL_MAX = 3;
/** A fill date may add at most this share of the leg to the drive, or FILL_MIN_DETOUR_KM on a short leg. */
export const FILL_DETOUR_SHARE = 0.25;
export const FILL_MIN_DETOUR_KM = 150;
/** Further down the fan map than this, a city is no stronger a market for this artist than any other. */
export const FILL_MAX_RANK = 100;

/** Hours of driving that fit in `days` days ending on a show day: travel days at 11 h, the show day at 8 h. */
const hoursIn = (days: number) => (days <= 0 ? 0 : SHOW_DAY_DRIVE_H + (days - 1) * TRAVEL_DAY_DRIVE_H);

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** A room another plan on this tour named in a city: the model-alone tour's stops (plan.guess.stops). */
export type KnownRoom = { marketId?: string; venue?: string; venueId?: string };

/**
 * Every leg with dark days, and the fan cities that could fill one of them. The first stop (no show before) has
 * none. `known` names a room in a fill city when this tour's own data has one found on Qloo there; otherwise the
 * option carries no room and the tour book prints "room to find".
 */
export function fillDates(stops: FillStop[], cities: FillCity[], region?: keyof typeof RADIUS_BY_REGION, known: KnownRoom[] = []): FillLeg[] {
  const roomIn = new Map(known.filter((k) => k.marketId && k.venue && k.venueId).map((k) => [k.marketId!, k.venue!]));
  const radius = radiusFor(region);
  const onTour = new Set(stops.map((s) => s.marketId));
  const out: FillLeg[] = [];
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1]!;
    const next = stops[i]!;
    if (!next.travelDays && !next.dayOff) continue;
    const lastNight = addDays(prev.date, (prev.nights ?? 1) - 1);
    const gap = daysBetween(lastNight, next.date);
    if (gap < 2) continue;
    const dark = Array.from({ length: gap - 1 }, (_, k) => addDays(lastNight, k + 1));
    const leg = travel(prev, next);
    const direct = roadKm(prev, next);
    const maxDetour = Math.max(FILL_MIN_DETOUR_KM, FILL_DETOUR_SHARE * direct);
    const options: FillOption[] = [];
    for (const c of [...cities].sort((a, b) => a.rank - b.rank)) {
      if (c.rank > FILL_MAX_RANK || options.length >= FILL_MAX) break;
      if (onTour.has(c.marketId)) continue;
      // The radius clause: a show this close to a booked one would split its audience.
      if (stops.some((s) => km(s, c) < radius)) continue;
      const a = travel(prev, c);
      const b = travel(c, next);
      const added = Math.round(roadKm(prev, c) + roadKm(c, next) - direct);
      if (added > maxDetour) continue;
      // Play it on the first dark day the drive allows, and still make the next show on its date.
      const day = dark.findIndex((_, k) => a.hours <= hoursIn(k + 1) && b.hours <= hoursIn(gap - (k + 1)));
      if (day < 0) continue;
      options.push({ marketId: c.marketId, city: c.name, fanRank: c.rank, addedKm: Math.max(0, added), fromKm: Math.round(a.km), fromHours: Math.round(a.hours * 10) / 10, date: dark[day]!, ...(roomIn.has(c.marketId) ? { room: roomIn.get(c.marketId)! } : {}) });
    }
    out.push({ index: i, from: prev.city, to: next.city, km: Math.round(leg.km), hours: Math.round(leg.hours * 10) / 10, travelDays: next.travelDays, dayOff: next.dayOff, dark, options });
  }
  return out;
}

/* ───────────── the run in legs ───────────── */

/** US states and Canadian provinces by touring region (the census regions, with the Southwest split out). */
const REGION_OF: Record<string, string> = {
  ...Object.fromEntries(["TN", "NC", "SC", "GA", "FL", "AL", "MS", "KY", "VA", "WV", "AR", "LA"].map((s) => [s, "Southeast"])),
  ...Object.fromEntries(["OH", "IN", "IL", "MI", "WI", "MN", "IA", "MO", "KS", "NE", "SD", "ND"].map((s) => [s, "Midwest"])),
  ...Object.fromEntries(["NY", "NJ", "PA", "MA", "CT", "RI", "VT", "NH", "ME", "MD", "DE", "DC", "ON", "QC", "NS", "NB", "PE", "NL"].map((s) => [s, "Northeast"])),
  ...Object.fromEntries(["TX", "OK", "NM", "AZ"].map((s) => [s, "Southwest"])),
  ...Object.fromEntries(["CO", "UT", "WY", "MT", "ID", "NV", "CA", "OR", "WA", "AK", "HI", "BC", "AB", "SK", "MB"].map((s) => [s, "West"])),
};

/** "Nashville, TN" → "Southeast"; a leg is named by a region only when most of its cities are in it. */
function legRegion(labels: string[]): string | undefined {
  const regions = labels.map((l) => REGION_OF[(l.split(",").at(-1) ?? "").trim().toUpperCase()]);
  const counts = new Map<string, number>();
  for (const r of regions) if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] / labels.length > 0.5 ? top[0] : undefined;
}

export type RunLegs = {
  legs: { region?: string; first: string; last: string; stops: number }[];
  /** The jump between each pair of legs. */
  jumps: { from: string; to: string; km: number; hours: number; travelDays: number }[];
};

/** A jump of this many travel days splits the run into legs, the way a booker would plan it. */
export const LEG_JUMP_DAYS = 2;

/** The run as a booker reads it: legs split wherever one drive takes two travel days or more. Null for one leg. */
export function runLegs(stops: (FillStop & { label?: string; fromKm: number; fromHours: number })[]): RunLegs | null {
  const cuts = stops.map((s, i) => (i > 0 && s.travelDays >= LEG_JUMP_DAYS ? i : -1)).filter((i) => i > 0);
  if (!cuts.length) return null;
  const bounds = [0, ...cuts, stops.length];
  const legs = bounds.slice(0, -1).map((b, k) => {
    const part = stops.slice(b, bounds[k + 1]);
    return { region: legRegion(part.map((s) => s.label ?? s.city)), first: part[0]!.city, last: part.at(-1)!.city, stops: part.length };
  });
  const jumps = cuts.map((i) => ({ from: stops[i - 1]!.city, to: stops[i]!.city, km: stops[i]!.fromKm, hours: stops[i]!.fromHours, travelDays: stops[i]!.travelDays }));
  return { legs, jumps };
}
