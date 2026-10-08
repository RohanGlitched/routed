import { km } from "./markets";

/**
 * The routing rules a tour manager would apply, kept deterministic so a model never decides a date or a drive:
 * - road distance ≈ 1.2 × great-circle distance; a van averages about 85 km/h door to door;
 * - a show day allows up to 8 hours of driving (load-in is mid-afternoon), a travel day up to 11;
 * - after five shows in a row the band gets a day off;
 * - two shows closer than the radius (150 km) would split one audience, so only the stronger city is picked.
 */
export const ROAD_FACTOR = 1.2;
export const VAN_KMH = 85;
export const SHOW_DAY_DRIVE_H = 8;
export const TRAVEL_DAY_DRIVE_H = 11;
export const MAX_SHOWS_IN_A_ROW = 5;
export const RADIUS_KM = 150;

type Point = { lat: number; lon: number };

export const roadKm = (a: Point, b: Point) => Math.round(km(a, b) * ROAD_FACTOR);
export const driveHours = (a: Point, b: Point) => Math.round((roadKm(a, b) / VAN_KMH) * 10) / 10;

/**
 * Picks `n` cities from a ranked list, skipping any within the radius of a city already picked. The order of
 * `ranked` is the preference (strongest first); the result keeps that order.
 */
export function pickCities<T extends { market: Point }>(ranked: T[], n: number, radiusKm = RADIUS_KM): T[] {
  const picked: T[] = [];
  for (const c of ranked) {
    if (picked.length >= n) break;
    if (picked.some((p) => km(p.market, c.market) < radiusKm)) continue;
    picked.push(c);
  }
  return picked;
}

/** Total road distance of an open path that starts at `from` and visits `stops` in order. */
export function pathKm(from: Point, stops: Point[]): number {
  let total = 0;
  let prev = from;
  for (const s of stops) {
    total += roadKm(prev, s);
    prev = s;
  }
  return total;
}

/**
 * Orders the stops into the shortest drive we can find from the starting city: nearest neighbour, then 2-opt
 * until no swap helps. Eleven stops is far below where this stops being near-optimal.
 */
export function orderStops<T extends Point>(from: Point, stops: T[]): T[] {
  if (stops.length < 3) return [...stops].sort((a, b) => km(from, a) - km(from, b));
  const left = [...stops];
  const path: T[] = [];
  let cur: Point = from;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (km(cur, left[i]!) < km(cur, left[bi]!)) bi = i;
    const [next] = left.splice(bi, 1);
    path.push(next!);
    cur = next!;
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const cand = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
        if (pathKm(from, cand) + 0.5 < pathKm(from, path)) {
          path.splice(0, path.length, ...cand);
          improved = true;
        }
      }
    }
  }
  return path;
}

/** The longest leg of the ordered route (road km), with the index of the stop it arrives at; null for one stop or none. */
export function worstLeg(from: Point, ordered: Point[]): { index: number; km: number } | null {
  if (ordered.length < 2) return null;
  let worst = { index: 0, km: -1 };
  let prev = from;
  ordered.forEach((s, i) => {
    const d = roadKm(prev, s);
    if (i > 0 && d > worst.km) worst = { index: i, km: d };
    prev = s;
  });
  return worst.km < 0 ? null : worst;
}

export type Leg<T> = {
  stop: T;
  /** ISO date of the show. */
  date: string;
  fromKm: number;
  fromHours: number;
  /** Days with no show just before this one: travel days and days off. */
  travelDays: number;
  dayOff: boolean;
};

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Puts the ordered stops on the calendar from `firstDate`: the first show is on that date (the drive from the
 * starting city happens before it), each next show is the next day unless the drive needs travel days, and a
 * day off follows every fifth show in a row.
 */
export function schedule<T extends Point>(from: Point, ordered: T[], firstDate: string): Leg<T>[] {
  const legs: Leg<T>[] = [];
  let date = firstDate;
  let inARow = 0;
  let prev: Point = from;
  ordered.forEach((stop, i) => {
    const h = driveHours(prev, stop);
    let travelDays = 0;
    let dayOff = false;
    if (i > 0) {
      travelDays = h > SHOW_DAY_DRIVE_H ? Math.ceil((h - SHOW_DAY_DRIVE_H) / TRAVEL_DAY_DRIVE_H) : 0;
      if (inARow >= MAX_SHOWS_IN_A_ROW && travelDays === 0) {
        dayOff = true;
        travelDays = 1;
      }
      if (travelDays > 0) inARow = 0;
      date = addDays(date, 1 + travelDays);
    }
    inARow++;
    legs.push({ stop, date, fromKm: roadKm(prev, stop), fromHours: h, travelDays, dayOff });
    prev = stop;
  });
  return legs;
}
