import { km } from "./markets";

/**
 * The routing rules a tour manager would apply, kept deterministic so a model never decides a date or a drive:
 * - road distance ≈ 1.2 × great-circle distance; a van averages about 85 km/h door to door;
 * - a show day allows up to 8 hours of driving (load-in is mid-afternoon), a travel day up to 11;
 * - after five shows in a row the band gets a day off;
 * - two shows closer than the radius (150 km) would split one audience, so only the stronger city is picked,
 *   unless both are major markets (1.5 million or more: New York and Philadelphia each carry their own show);
 * - no leg between two shows is longer than MAX_LEG_KM of road (two days in the van).
 */
export const ROAD_FACTOR = 1.2;
export const VAN_KMH = 85;
export const SHOW_DAY_DRIVE_H = 8;
export const TRAVEL_DAY_DRIVE_H = 11;
export const MAX_SHOWS_IN_A_ROW = 5;
export const RADIUS_KM = 150;
/**
 * The radius clause by region: wide where touring cities are far apart, tight where they aren't. In the UK and
 * Ireland a real tour plays London and Brighton (76 km) in the same run, and Glasgow and Edinburgh (67 km).
 */
export const RADIUS_BY_REGION = { na: 150, eu: 120, uk: 60 } as const;
export const radiusFor = (region?: keyof typeof RADIUS_BY_REGION) => (region ? RADIUS_BY_REGION[region] : RADIUS_KM);
/** A leg longer than this (road km) is two or more days in the van with no show: the leg rule breaks it up. */
export const MAX_LEG_KM = 1800;
/** A city this big is a market of its own: the radius clause never drops it for a smaller neighbour. */
export const MAJOR_POP = 1_500_000;

type Point = { lat: number; lon: number };

export const roadKm = (a: Point, b: Point) => Math.round(km(a, b) * ROAD_FACTOR);
export const driveHours = (a: Point, b: Point) => Math.round((roadKm(a, b) / VAN_KMH) * 10) / 10;

export const isMajor = (m: { pop?: number }) => (m.pop ?? 0) >= MAJOR_POP;

/** The radius clause: closer than RADIUS_KM splits one audience, unless both cities are major markets. */
export function tooClose(a: Point & { pop?: number }, b: Point & { pop?: number }, radius: number = RADIUS_KM): boolean {
  return km(a, b) < radius && !(isMajor(a) && isMajor(b));
}

/** Legs between two shows (not the drive to the first one) longer than `max` road km, in route order. */
export function longLegs(from: Point, ordered: Point[], max = MAX_LEG_KM): { index: number; km: number }[] {
  const out: { index: number; km: number }[] = [];
  let prev = from;
  ordered.forEach((s, i) => {
    const d = roadKm(prev, s);
    if (i > 0 && d > max) out.push({ index: i, km: d });
    prev = s;
  });
  return out;
}

/**
 * The stops split into groups that can reach each other through legs of at most `max` road km. One group means
 * a route exists without a long leg; two (a West Coast run and an East Coast run) means a jump between them.
 */
export function legGroups<T extends Point>(stops: T[], max = MAX_LEG_KM): T[][] {
  const groups: T[][] = [];
  const seen = new Set<number>();
  for (let i = 0; i < stops.length; i++) {
    if (seen.has(i)) continue;
    const group: T[] = [];
    const queue = [i];
    seen.add(i);
    while (queue.length) {
      const j = queue.shift()!;
      group.push(stops[j]!);
      for (let k = 0; k < stops.length; k++) {
        if (!seen.has(k) && roadKm(stops[j]!, stops[k]!) <= max) {
          seen.add(k);
          queue.push(k);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Picks `n` cities from a ranked list, skipping any within the radius of a city already picked. The order of
 * `ranked` is the preference (strongest first); the result keeps that order.
 */
export function pickCities<T extends { market: Point & { pop?: number } }>(ranked: T[], n: number, radius: number = RADIUS_KM): T[] {
  const picked: T[] = [];
  for (const c of ranked) {
    if (picked.length >= n) break;
    if (picked.some((p) => tooClose(p.market, c.market, radius))) continue;
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

export type Candidate = Point & { id: string; rank: number; pop?: number };
export type LegSwap<T> = { out: T; in: T; km: number };

/** A major market this high on the artist's fan map is always on the tour. */
export const ANCHOR_RANK = 10;
export const isAnchor = (c: { rank: number; pop?: number }) => c.rank <= ANCHOR_RANK && isMajor(c);

/**
 * The anchor rule: a major market in the artist's top ten is always on the tour. A smaller city inside its
 * radius gives way (no UK tour skips London because Brighton was booked first); when the tour is already full,
 * the weakest stop that isn't an anchor does. Slots freed beyond that are refilled from the ranking. Returns
 * the stops and what changed, for the call sheet.
 */
export async function keepAnchors<T extends Candidate>(stops: T[], ranked: T[], shows: number, usable: (c: T) => Promise<boolean>, radius: number = RADIUS_KM): Promise<{ stops: T[]; added: { anchor: T; out: T[] }[] }> {
  let out = [...stops];
  const added: { anchor: T; out: T[] }[] = [];
  const fill = async () => {
    for (const c of ranked) {
      if (out.length >= shows) break;
      if (out.some((s) => s.id === c.id || tooClose(s, c, radius))) continue;
      if (await usable(c)) out.push(c);
    }
  };
  for (const anchor of ranked.filter(isAnchor)) {
    if (out.some((s) => s.id === anchor.id)) continue;
    if (out.some((s) => isAnchor(s) && tooClose(s, anchor, radius))) continue;
    const near = out.filter((s) => tooClose(s, anchor, radius));
    const weakest = [...out].filter((s) => !isAnchor(s)).sort((a, b) => b.rank - a.rank)[0];
    const gone = near.length ? near : out.length >= shows && weakest ? [weakest] : [];
    // An anchor the tour can't reach without a long leg (Chicago on a West Coast run) is left to the leg rule.
    const stay = out.filter((s) => !gone.includes(s));
    if (stay.length && !stay.some((s) => roadKm(s, anchor) <= MAX_LEG_KM)) continue;
    if (!(await usable(anchor))) continue;
    out = out.filter((s) => !gone.includes(s));
    out.push(anchor);
    added.push({ anchor, out: gone });
    await fill();
  }
  return { stops: out, added };
}

/**
 * The leg rule: no leg between two shows longer than `max` road km. First, when the stops fall into groups that
 * can't reach each other (a West Coast run and an East Coast run), the strongest group is kept (by weight: an
 * anchor market counts more, and a group the band can reach from the starting city gets a little extra) and each
 * stop outside it is replaced by the strongest city in the pool that joins the kept group and has rooms. Then any
 * long leg left over is broken by swapping one of its two ends for the strongest city that leaves fewer long
 * legs. A city is only tried when `usable` says it has rooms, and at most `maxTries` cities are tried per swap,
 * so the lookups stay bounded. Whatever can't be fixed stays, and the day sheet says so.
 */
export async function repairLegs<T extends Candidate>(opts: {
  from: Point;
  stops: T[];
  pool: T[];
  usable: (c: T) => Promise<boolean>;
  weight?: (c: T) => number;
  max?: number;
  maxSwaps?: number;
  maxTries?: number;
  radius?: number;
}): Promise<{ stops: T[]; swaps: LegSwap<T>[] }> {
  const max = opts.max ?? MAX_LEG_KM;
  const weight = opts.weight ?? (() => 1);
  const maxTries = opts.maxTries ?? 5;
  let stops = [...opts.stops];
  const swaps: LegSwap<T>[] = [];
  const tried = new Map<string, boolean>();
  const usable = async (c: T) => {
    if (!tried.has(c.id)) tried.set(c.id, await opts.usable(c));
    return tried.get(c.id)!;
  };
  const used = (c: T) => stops.some((s) => s.id === c.id);
  const clashes = (c: T, except?: T) => stops.some((s) => s !== except && tooClose(s, c, opts.radius));

  // 1. Groups that can't reach each other: keep the strongest, pull the rest into it.
  const groups = legGroups(stops, max);
  if (groups.length > 1) {
    const score = (g: T[]) => g.reduce((n, c) => n + weight(c), 0) + (g.some((c) => roadKm(opts.from, c) <= max) ? 0.5 : 0) - g.reduce((n, c) => n + c.rank, 0) / 1e6;
    const kept = [...groups].sort((a, b) => score(b) - score(a))[0]!;
    const outside = stops.filter((s) => !kept.includes(s)).sort((a, b) => b.rank - a.rank);
    for (const far of outside) {
      let tries = 0;
      for (const c of opts.pool) {
        if (tries >= maxTries) break;
        if (used(c) || clashes(c, far) || !kept.some((k) => roadKm(k, c) <= max)) continue;
        tries++;
        if (!(await usable(c))) continue;
        const km = Math.min(...kept.map((k) => roadKm(k, far)));
        stops = stops.map((s) => (s === far ? c : s));
        kept.push(c);
        swaps.push({ out: far, in: c, km });
        break;
      }
    }
  }

  // 2. Long legs left over (the shortest drive can still jump): swap one end for a city that leaves fewer.
  const badness = (list: T[]) => {
    const long = longLegs(opts.from, orderStops(opts.from, list), max);
    return { n: long.length, worst: Math.max(0, ...long.map((l) => l.km)) };
  };
  for (let round = 0; round < (opts.maxSwaps ?? 4); round++) {
    const ordered = orderStops(opts.from, stops);
    const long = longLegs(opts.from, ordered, max);
    if (!long.length) break;
    const worst = long.reduce((a, b) => (b.km > a.km ? b : a));
    const now = badness(stops);
    const ends = [ordered[worst.index - 1]!, ordered[worst.index]!].sort((a, b) => b.rank - a.rank);
    const options: { end: T; c: T; n: number; worst: number }[] = [];
    for (const end of ends) {
      for (const c of opts.pool) {
        if (used(c) || clashes(c, end)) continue;
        const b = badness(stops.map((s) => (s === end ? c : s)));
        if (b.n < now.n || (b.n === now.n && b.worst < now.worst - 1)) options.push({ end, c, ...b });
      }
    }
    // Fewest long legs first; then the swap that gives up the least fan strength (never trade the artist's #1 for
    // #8 when swapping the other end costs less); then the shorter worst leg.
    options.sort((a, b) => a.n - b.n || a.c.rank - a.end.rank - (b.c.rank - b.end.rank) || a.worst - b.worst);
    let done = false;
    for (const o of options.slice(0, maxTries)) {
      if (!(await usable(o.c))) continue;
      stops = stops.map((s) => (s === o.end ? o.c : s));
      swaps.push({ out: o.end, in: o.c, km: worst.km });
      done = true;
      break;
    }
    if (!done) break;
  }
  return { stops, swaps };
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
  /** ISO date of the show (the first night of a two-night stand). */
  date: string;
  /** Nights in this room: 2 when the room holds less than the crowd and a second night covers it. */
  nights: number;
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
 * starting city happens before it), each next show is the day after the last night in the previous room unless
 * the drive needs travel days, and a day off follows every fifth show in a row (a two-night stand is two shows).
 */
export function schedule<T extends Point & { nights?: number }>(from: Point, ordered: T[], firstDate: string): Leg<T>[] {
  const legs: Leg<T>[] = [];
  let date = firstDate;
  let lastNight = firstDate;
  let inARow = 0;
  let prev: Point = from;
  ordered.forEach((stop, i) => {
    const h = driveHours(prev, stop);
    const nights = Math.max(1, Math.min(2, Math.round(stop.nights ?? 1)));
    let travelDays = 0;
    let dayOff = false;
    if (i > 0) {
      travelDays = h > SHOW_DAY_DRIVE_H ? Math.ceil((h - SHOW_DAY_DRIVE_H) / TRAVEL_DAY_DRIVE_H) : 0;
      if (inARow >= MAX_SHOWS_IN_A_ROW && travelDays === 0) {
        dayOff = true;
        travelDays = 1;
      }
      if (travelDays > 0) inARow = 0;
      date = addDays(lastNight, 1 + travelDays);
    }
    inARow += nights;
    lastNight = addDays(date, nights - 1);
    legs.push({ stop, date, nights, fromKm: roadKm(prev, stop), fromHours: h, travelDays, dayOff });
    prev = stop;
  });
  return legs;
}

export { addDays };
