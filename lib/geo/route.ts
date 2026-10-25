import { km, marketById, MARKETS, nearestMarket } from "./markets";

/**
 * The routing rules a tour manager would apply, kept deterministic so a model never decides a date or a drive:
 * - road distance ≈ 1.2 × great-circle distance; a van averages about 85 km/h door to door;
 * - water is crossed where the ferries sail (North Channel, Irish Sea, English Channel, the Baltic, BC Ferries
 *   and others), with the sailing and check-in counted in the hours, and a hard border (US and Canada, the UK and
 *   the EU) adds time at the crossing;
 * - a show day allows up to 8 hours of driving (load-in is mid-afternoon), a travel day up to 11;
 * - after five shows in a row the band gets a day off;
 * - two shows closer than the radius (150 km) would split one audience, so only the stronger city is picked,
 *   unless both are major markets (1.5 million or more: New York and Philadelphia each carry their own show);
 * - no leg between two shows costs more than MAX_LEG_KM of road (two days in the van), and the order of the stops
 *   is searched exactly (up to EXACT_MAX stops) for one that keeps every leg under the cap before any city is
 *   swapped out;
 * - the route keeps each country's dates together (a soft cost per border crossing).
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
/** A van run's leg cap: one travel day at most between two shows. Pass it as `max` to route a tight run. */
export const VAN_LEG_KM = 1100;
/** A van run's shape: about this much road per show, start to finish (the drive from home included). */
export const KM_PER_SHOW_VAN = 450;
/** Runs this short are routed as one regional cluster first (`clusterCities`), not coast to coast. */
export const CLUSTER_MAX_SHOWS = 10;
/** A city this big is a market of its own: the radius clause never drops it for a smaller neighbour. */
export const MAJOR_POP = 1_500_000;
/** The soft cost of crossing a border in the route search (road km): each country's dates stay together. */
export const BORDER_KM = 100;
/** Up to this many stops the order is searched exactly (every order, by dynamic programming); beyond it, 2-opt. */
export const EXACT_MAX = 12;

type Point = { lat: number; lon: number };

export const roadKm = (a: Point, b: Point) => Math.round(km(a, b) * ROAD_FACTOR);

/* ───────────── countries, water and borders ───────────── */

const byPoint = new Map(MARKETS.map((m) => [`${m.lat},${m.lon}`, m]));
const ccMemo = new Map<string, string | undefined>();

/** The country a point is in: its own `cc`, its market id, the market at exactly those coordinates, or the nearest one. */
export function countryOf(p: Point & { cc?: string; id?: string; marketId?: string }): string | undefined {
  if (p.cc) return p.cc;
  const m = (p.marketId && marketById(p.marketId)) || (p.id && marketById(p.id)) || byPoint.get(`${p.lat},${p.lon}`);
  if (m) return m.cc;
  const key = `${p.lat},${p.lon}`;
  if (!ccMemo.has(key)) {
    if (ccMemo.size > 20_000) ccMemo.clear();
    ccMemo.set(key, nearestMarket(p, undefined, 80)?.cc);
  }
  return ccMemo.get(key);
}

/** The land a point stands on, as far as a van is concerned: going from one to another means a ferry or a long way round. */
export type Land = "na" | "ns" | "nl" | "vi" | "hawaii" | "gb" | "ie" | "eu" | "scan" | "fi" | "is" | "sicily" | "sardinia" | "balearics" | "tenerife" | "gran-canaria" | "crete";

const inBox = (p: Point, lat0: number, lat1: number, lon0: number, lon1: number) => p.lat >= lat0 && p.lat <= lat1 && p.lon >= lon0 && p.lon <= lon1;

export function landOf(p: Point & { cc?: string; id?: string; marketId?: string }): Land {
  const cc = countryOf(p);
  // The island of Ireland: the Republic and Northern Ireland (GB) alike.
  if (inBox(p, 51.3, 55.45, -10.7, -5.4)) return "ie";
  if (cc === "GB" || (!cc && inBox(p, 49.9, 60.9, -8.2, 1.8))) return "gb";
  if (cc === "IS" || inBox(p, 63, 67, -25, -13)) return "is";
  if (cc === "FI") return "fi";
  // Sweden and Norway: road to the rest of Europe only over the Øresund Bridge, never across the Baltic.
  if (cc === "SE" || cc === "NO") return "scan";
  // Sicily stops west of the Strait of Messina (Reggio Calabria, at 15.65°E, is the mainland).
  if (inBox(p, 36.6, 38.35, 12.3, 15.6)) return "sicily";
  if (inBox(p, 38.8, 41.3, 8.1, 9.9)) return "sardinia";
  if (inBox(p, 38.6, 40.1, 1.1, 4.4)) return "balearics";
  if (inBox(p, 27.5, 29.5, -18.2, -13.3)) return p.lon < -16 ? "tenerife" : "gran-canaria";
  if (inBox(p, 34.8, 35.7, 23.4, 26.4)) return "crete";
  if (inBox(p, 18.5, 22.5, -161, -154.5)) return "hawaii";
  if (cc === "CA" || (!cc && p.lon < -30)) {
    if (inBox(p, 46.6, 51.8, -59.5, -52.5)) return "nl";
    if (inBox(p, 48.3, 50.9, -128.5, -123.25)) return "vi";
    // Nova Scotia (Halifax; Sydney on Cape Breton): road only through the Chignecto Isthmus at Amherst, so
    // Boston to Halifax goes round the Gulf of Maine, not across it. Saint John, NB (66.06°W) is outside.
    if ((p.lat < 45.75 && p.lon > -66.0) || inBox(p, 45.5, 47.1, -61.6, -59.6)) return "ns";
  }
  if (cc === "US" || cc === "CA" || (!cc && p.lon < -30)) return "na";
  return "eu";
}

/** A way between two lands: a ferry (sailing and check-in hours) or a road gateway (a point the road must pass). */
export type Crossing = { name: string; a: Land; b: Land; pa: Point; pb: Point; seaH: number; bufferH: number; ferry: boolean };

const P = (lat: number, lon: number) => ({ lat, lon });
/**
 * The water crossings a touring van uses, with the usual sailing time and check-in. Where several sail, the
 * route takes whichever gets there soonest, door to door.
 */
export const CROSSINGS: Crossing[] = [
  { name: "North Channel ferry, Belfast–Cairnryan", a: "ie", b: "gb", pa: P(54.62, -5.9), pb: P(54.97, -5.03), seaH: 2.25, bufferH: 1, ferry: true },
  { name: "Irish Sea ferry, Dublin–Holyhead", a: "ie", b: "gb", pa: P(53.35, -6.2), pb: P(53.31, -4.63), seaH: 3.25, bufferH: 1, ferry: true },
  { name: "Irish Sea ferry, Belfast–Birkenhead", a: "ie", b: "gb", pa: P(54.62, -5.9), pb: P(53.39, -3.01), seaH: 8, bufferH: 1, ferry: true },
  { name: "St George's Channel ferry, Rosslare–Fishguard", a: "ie", b: "gb", pa: P(52.25, -6.34), pb: P(51.99, -4.98), seaH: 3.5, bufferH: 1, ferry: true },
  { name: "St George's Channel ferry, Rosslare–Pembroke", a: "ie", b: "gb", pa: P(52.25, -6.34), pb: P(51.69, -4.94), seaH: 4, bufferH: 1, ferry: true },
  { name: "Celtic Sea ferry, Rosslare–Cherbourg", a: "ie", b: "eu", pa: P(52.25, -6.34), pb: P(49.65, -1.62), seaH: 18, bufferH: 1.5, ferry: true },
  { name: "English Channel ferry, Dover–Calais", a: "gb", b: "eu", pa: P(51.13, 1.31), pb: P(50.97, 1.86), seaH: 1.5, bufferH: 1, ferry: true },
  { name: "English Channel ferry, Portsmouth–Caen", a: "gb", b: "eu", pa: P(50.81, -1.09), pb: P(49.28, -0.25), seaH: 6, bufferH: 1, ferry: true },
  { name: "North Sea ferry, Harwich–Hook of Holland", a: "gb", b: "eu", pa: P(51.95, 1.29), pb: P(51.98, 4.13), seaH: 6.75, bufferH: 1, ferry: true },
  { name: "North Sea ferry, Hull–Rotterdam", a: "gb", b: "eu", pa: P(53.74, -0.28), pb: P(51.95, 4.13), seaH: 11, bufferH: 1, ferry: true },
  { name: "North Sea ferry, Newcastle–IJmuiden", a: "gb", b: "eu", pa: P(55.0, -1.45), pb: P(52.46, 4.6), seaH: 15.5, bufferH: 1, ferry: true },
  { name: "Øresund Bridge, Copenhagen–Malmö", a: "eu", b: "scan", pa: P(55.58, 12.83), pb: P(55.58, 12.83), seaH: 0, bufferH: 0, ferry: false },
  { name: "Gulf of Finland ferry, Tallinn–Helsinki", a: "eu", b: "fi", pa: P(59.44, 24.77), pb: P(60.16, 24.95), seaH: 2.25, bufferH: 1, ferry: true },
  { name: "Baltic ferry, Stockholm–Turku", a: "scan", b: "fi", pa: P(59.35, 18.1), pb: P(60.44, 22.22), seaH: 11, bufferH: 1, ferry: true },
  { name: "road round the Gulf of Bothnia, via Tornio", a: "scan", b: "fi", pa: P(65.85, 24.14), pb: P(65.85, 24.14), seaH: 0, bufferH: 0, ferry: false },
  { name: "North Atlantic ferry, Hirtshals–Seyðisfjörður", a: "eu", b: "is", pa: P(57.59, 9.96), pb: P(65.26, -14.0), seaH: 47, bufferH: 2, ferry: true },
  { name: "Strait of Messina ferry, Villa San Giovanni–Messina", a: "eu", b: "sicily", pa: P(38.22, 15.64), pb: P(38.19, 15.56), seaH: 0.5, bufferH: 0.5, ferry: true },
  { name: "Tyrrhenian ferry, Civitavecchia–Olbia", a: "eu", b: "sardinia", pa: P(42.09, 11.79), pb: P(40.92, 9.52), seaH: 6, bufferH: 1, ferry: true },
  { name: "Tyrrhenian ferry, Livorno–Olbia", a: "eu", b: "sardinia", pa: P(43.55, 10.3), pb: P(40.92, 9.52), seaH: 7, bufferH: 1, ferry: true },
  { name: "Ligurian ferry, Genoa–Porto Torres", a: "eu", b: "sardinia", pa: P(44.41, 8.92), pb: P(40.84, 8.4), seaH: 11, bufferH: 1, ferry: true },
  { name: "Balearic ferry, Barcelona–Palma", a: "eu", b: "balearics", pa: P(41.36, 2.17), pb: P(39.56, 2.63), seaH: 7.5, bufferH: 1, ferry: true },
  { name: "Balearic ferry, Valencia–Palma", a: "eu", b: "balearics", pa: P(39.45, -0.32), pb: P(39.56, 2.63), seaH: 8, bufferH: 1, ferry: true },
  { name: "Aegean ferry, Piraeus–Heraklion", a: "eu", b: "crete", pa: P(37.94, 23.64), pb: P(35.34, 25.14), seaH: 9, bufferH: 1, ferry: true },
  { name: "Atlantic ferry, Huelva–Santa Cruz de Tenerife", a: "eu", b: "tenerife", pa: P(37.25, -6.95), pb: P(28.47, -16.24), seaH: 33, bufferH: 2, ferry: true },
  { name: "Canaries ferry, Santa Cruz de Tenerife–Agaete", a: "tenerife", b: "gran-canaria", pa: P(28.47, -16.24), pb: P(28.1, -15.7), seaH: 1.5, bufferH: 1, ferry: true },
  { name: "BC Ferries, Tsawwassen–Swartz Bay", a: "na", b: "vi", pa: P(49.01, -123.13), pb: P(48.69, -123.41), seaH: 1.6, bufferH: 1, ferry: true },
  { name: "BC Ferries, Horseshoe Bay–Nanaimo", a: "na", b: "vi", pa: P(49.37, -123.27), pb: P(49.19, -123.95), seaH: 1.7, bufferH: 1, ferry: true },
  { name: "Coho ferry, Port Angeles–Victoria", a: "na", b: "vi", pa: P(48.12, -123.43), pb: P(48.42, -123.37), seaH: 1.5, bufferH: 1, ferry: true },
  { name: "road round the Gulf of Maine, via Amherst, NS", a: "na", b: "ns", pa: P(45.83, -64.21), pb: P(45.83, -64.21), seaH: 0, bufferH: 0, ferry: false },
  { name: "Marine Atlantic ferry, North Sydney–Port aux Basques", a: "ns", b: "nl", pa: P(46.21, -60.25), pb: P(47.57, -59.14), seaH: 7, bufferH: 2, ferry: true },
];

/** EU and Schengen borders are open; these countries have customs (a carnet and declared merch) at the border. */
const CUSTOMS = new Set(["US", "CA", "GB", "CH", "NO", "RS", "IS"]);

/**
 * Hours at the border between two countries: US and Canada about 1.5 h (passports, work permits, merch declared),
 * a customs border 1 h, none inside the EU or Schengen area, or between the UK and Ireland (Common Travel Area).
 */
export function borderHours(a: Point, b: Point): number {
  const x = countryOf(a), y = countryOf(b);
  if (!x || !y || x === y) return 0;
  const pair = [x, y].sort().join("|");
  if (pair === "CA|US") return 1.5;
  if (pair === "GB|IE") return 0;
  return CUSTOMS.has(x) || CUSTOMS.has(y) ? 1 : 0;
}

/** One leg, door to door: road km driven, hours (driving, sailing, check-in, border), and the ferry when there is one. */
export type Travel = { km: number; hours: number; ferry?: { name: string; hours: number }; borderH?: number };

const travelMemo = new Map<string, Travel>();

/** The ways from one land to another through at most three crossings (Ireland to France goes through Britain). */
function chains(from: Land, to: Land): Crossing[][] {
  const out: Crossing[][] = [];
  const walk = (at: Land, path: Crossing[], seen: Set<Land>) => {
    if (at === to) {
      out.push(path);
      return;
    }
    if (path.length >= 3) return;
    for (const c of CROSSINGS) {
      const next = c.a === at ? c.b : c.b === at ? c.a : null;
      if (!next || seen.has(next)) continue;
      walk(next, [...path, c], new Set([...seen, next]));
    }
  };
  walk(from, [], new Set([from]));
  return out;
}

export function travel(a: Point, b: Point): Travel {
  const key = `${a.lat},${a.lon}>${b.lat},${b.lon}`;
  const hit = travelMemo.get(key);
  if (hit) return hit;
  const la = landOf(a), lb = landOf(b);
  let best: Travel = { km: roadKm(a, b), hours: roadKm(a, b) / VAN_KMH };
  if (la !== lb) {
    let bestH = Infinity;
    for (const chain of chains(la, lb)) {
      let at: Point = a;
      let land = la;
      let road = 0;
      let sea = 0;
      const ferries: Crossing[] = [];
      for (const c of chain) {
        const [enter, exit, next] = c.a === land ? [c.pa, c.pb, c.b] : [c.pb, c.pa, c.a];
        road += roadKm(at, enter);
        sea += c.seaH + c.bufferH;
        if (c.ferry) ferries.push(c);
        at = exit;
        land = next;
      }
      road += roadKm(at, b);
      const h = road / VAN_KMH + sea;
      if (h < bestH) {
        bestH = h;
        best = { km: road, hours: h, ...(ferries.length ? { ferry: { name: ferries.map((f) => f.name).join(", then "), hours: Math.round(ferries.reduce((n, f) => n + f.seaH + f.bufferH, 0) * 10) / 10 } } : {}) };
      }
    }
    // No crossing reaches it (Honolulu): the distance stays as the crow flies, and the day sheet shows it.
  }
  const border = borderHours(a, b);
  if (border) best = { ...best, hours: best.hours + border, borderH: border };
  if (travelMemo.size > 50_000) travelMemo.clear();
  travelMemo.set(key, best);
  return best;
}

/** Door-to-door hours of a leg: driving at VAN_KMH, plus any sailing, check-in and border time. */
export const driveHours = (a: Point, b: Point) => Math.round(travel(a, b).hours * 10) / 10;
/**
 * What a leg costs in road km, for the leg cap and the route search: the hours door to door at van speed. On
 * the mainland this is exactly `roadKm`; a ferry or a hard border adds its hours (Belfast to Glasgow: 132 km
 * driven plus the North Channel sailing).
 */
export const legCost = (a: Point, b: Point) => Math.round(travel(a, b).hours * VAN_KMH);

export const isMajor = (m: { pop?: number }) => (m.pop ?? 0) >= MAJOR_POP;

/** The radius clause: closer than RADIUS_KM splits one audience, unless both cities are major markets. */
export function tooClose(a: Point & { pop?: number }, b: Point & { pop?: number }, radius: number = RADIUS_KM): boolean {
  return km(a, b) < radius && !(isMajor(a) && isMajor(b));
}

/** Legs between two shows (not the drive to the first one) costing more than `max` road km, in route order. */
export function longLegs(from: Point, ordered: Point[], max = MAX_LEG_KM): { index: number; km: number }[] {
  const out: { index: number; km: number }[] = [];
  let prev = from;
  ordered.forEach((s, i) => {
    const d = legCost(prev, s);
    if (i > 0 && d > max) out.push({ index: i, km: d });
    prev = s;
  });
  return out;
}

/**
 * The stops split into groups that can reach each other through legs of at most `max` road km. One group means
 * every stop can be reached without a long leg; two (a West Coast run and an East Coast run) means a jump between them.
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
        if (!seen.has(k) && legCost(stops[j]!, stops[k]!) <= max) {
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

/** Total road distance (km driven, ferries' sea miles not counted) of an open path that starts at `from` and visits `stops` in order. */
export function pathKm(from: Point, stops: Point[]): number {
  let total = 0;
  let prev = from;
  for (const s of stops) {
    total += travel(prev, s).km;
    prev = s;
  }
  return total;
}

/* ───────────── the order of the stops ───────────── */

export type OrderOptions = {
  /** The leg cap (road km): the search first finds an order with no leg over it, if one exists. Default MAX_LEG_KM. */
  max?: number;
  /** The id of a stop that must open the run (a hometown show), and of one that must close it (the homecoming). */
  first?: string;
  last?: string;
  /** The soft cost of a border crossing, in road km. Default BORDER_KM; 0 turns it off. */
  borderKm?: number;
};

const LONG = 1e7;
const idOf = (s: object) => (s as { id?: string }).id ?? (s as { marketId?: string }).marketId;

/**
 * Orders the stops from the starting city: the fewest legs over the cap first, then the shortest drive (road km,
 * ferries at their hours, plus a soft cost per border so a country's dates stay together). Up to EXACT_MAX stops
 * every order is searched (dynamic programming over subsets: 12 stops is ~600k steps), so an order that keeps every
 * leg under the cap is always found when one exists. Longer runs use nearest neighbour, then 2-opt and moving
 * single stops until nothing helps. The drive to the first show is counted but never capped.
 */
export function orderStops<T extends Point>(from: Point, stops: T[], opts: OrderOptions = {}): T[] {
  const n = stops.length;
  if (n < 2) return [...stops];
  const max = opts.max ?? MAX_LEG_KM;
  const border = opts.borderKm ?? BORDER_KM;
  const cc = stops.map((s) => countryOf(s));
  const c0 = countryOf(from);
  const cross = (x?: string, y?: string) => (border && x && y && x !== y ? border : 0);
  const start = stops.map((s, i) => legCost(from, s) + cross(c0, cc[i]));
  const step = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = legCost(stops[i]!, stops[j]!);
      step[i * n + j] = d + cross(cc[i], cc[j]) + (d > max ? LONG : 0);
    }
  let fi = opts.first === undefined ? -1 : stops.findIndex((s) => idOf(s) === opts.first);
  let li = opts.last === undefined ? -1 : stops.findIndex((s) => idOf(s) === opts.last);
  if (li === fi) li = -1;
  const order = n <= EXACT_MAX ? exactOrder(n, start, step, fi, li) : localOrder(n, start, step, fi, li);
  return order.map((i) => stops[i]!);
}

function exactOrder(n: number, start: number[], step: Float64Array, fi: number, li: number): number[] {
  const full = (1 << n) - 1;
  const dp = new Float64Array((full + 1) * n).fill(Infinity);
  const par = new Int8Array((full + 1) * n).fill(-1);
  for (let j = 0; j < n; j++) {
    if (fi >= 0 && j !== fi) continue;
    if (j === li) continue;
    dp[(1 << j) * n + j] = start[j]!;
  }
  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < n; j++) {
      const v = dp[mask * n + j]!;
      if (v === Infinity) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const nm = mask | (1 << k);
        if (k === li && nm !== full) continue;
        const w = v + step[j * n + k]!;
        if (w < dp[nm * n + k]!) {
          dp[nm * n + k] = w;
          par[nm * n + k] = j;
        }
      }
    }
  }
  let end = -1;
  for (let j = 0; j < n; j++) if ((li < 0 || j === li) && (end < 0 || dp[full * n + j]! < dp[full * n + end]!)) end = j;
  const out: number[] = [];
  let mask = full;
  let j = end;
  while (j >= 0) {
    out.push(j);
    const p = par[mask * n + j]!;
    mask &= ~(1 << j);
    j = p;
  }
  return out.reverse();
}

function localOrder(n: number, start: number[], step: Float64Array, fi: number, li: number): number[] {
  const cost = (o: number[]) => o.reduce((s, x, i) => s + (i ? step[o[i - 1]! * n + x]! : start[x]!), 0);
  const left = [...Array(n).keys()].filter((i) => i !== fi && i !== li);
  const path: number[] = fi >= 0 ? [fi] : [];
  while (left.length) {
    const cur = path.at(-1);
    let bi = 0;
    const c = (i: number) => (cur === undefined ? start[left[i]!]! : step[cur * n + left[i]!]!);
    for (let i = 1; i < left.length; i++) if (c(i) < c(bi)) bi = i;
    path.push(left.splice(bi, 1)[0]!);
  }
  if (li >= 0) path.push(li);
  const lo = fi >= 0 ? 1 : 0;
  const hi = li >= 0 ? n - 2 : n - 1;
  let best = cost(path);
  let improved = true;
  while (improved) {
    improved = false;
    // 2-opt: reverse a stretch.
    for (let i = lo; i < hi; i++)
      for (let j = i + 1; j <= hi; j++) {
        const cand = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
        const c = cost(cand);
        if (c + 0.5 < best) {
          path.splice(0, n, ...cand);
          best = c;
          improved = true;
        }
      }
    // Or-opt: move one stop elsewhere.
    for (let i = lo; i <= hi; i++)
      for (let j = lo; j <= hi; j++) {
        if (i === j) continue;
        const cand = [...path];
        const [x] = cand.splice(i, 1);
        cand.splice(j, 0, x!);
        const c = cost(cand);
        if (c + 0.5 < best) {
          path.splice(0, n, ...cand);
          best = c;
          improved = true;
        }
      }
  }
  return path;
}

export type Candidate = Point & { id: string; rank: number; pop?: number; name?: string };
/** A city swapped out and the one that took its place; `reason` says which rule did it (the leg rule when absent). */
export type LegSwap<T> = { out: T; in: T; km: number; reason?: "leg" | "km-per-show" | "country" };

/** A major market this high on the artist's fan map is always on the tour. */
export const ANCHOR_RANK = 10;
export const isAnchor = (c: { rank: number; pop?: number }) => c.rank <= ANCHOR_RANK && isMajor(c);

/**
 * The anchor rule: a major market in the artist's top ten is always on the tour. A smaller city inside its
 * radius gives way (no UK tour skips London because Brighton was booked first); when the tour is already full,
 * the weakest stop that isn't an anchor does. Slots freed beyond that are refilled from the ranking. Returns
 * the stops and what changed, for the call sheet.
 */
export async function keepAnchors<T extends Candidate>(stops: T[], ranked: T[], shows: number, usable: (c: T) => Promise<boolean>, radius: number = RADIUS_KM, max: number = MAX_LEG_KM): Promise<{ stops: T[]; added: { anchor: T; out: T[] }[] }> {
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
    if (stay.length && !stay.some((s) => legCost(s, anchor) <= max)) continue;
    if (!(await usable(anchor))) continue;
    out = out.filter((s) => !gone.includes(s));
    out.push(anchor);
    added.push({ anchor, out: gone });
    await fill();
  }
  return { stops: out, added };
}

/* ───────────── the hometown ───────────── */

/** A starting city this high on the artist's fan map is played: no band routes past its hometown. */
export const HOME_RANK = 50;
/** How close a ranked city must be to the starting point to be the hometown show (km, as the crow flies). */
export const HOME_KM = 40;

/** The ranked city the band starts from, when it ranks in the top `rank` (Houston #43 for Khruangbin); else null. */
export function homeCity<T extends Candidate>(from: Point, ranked: T[], rank: number = HOME_RANK): T | null {
  const near = ranked.filter((c) => c.rank <= rank && km(from, c) <= HOME_KM).sort((a, b) => km(from, a) - km(from, b));
  return near[0] ?? null;
}

/**
 * The hometown rule: when the starting city ranks in the artist's top HOME_RANK it is on the tour (open there:
 * pass its id as `first` to orderStops and repairLegs, and as `keep` so no rule swaps it out). Cities inside its
 * radius give way; when the tour is full, the weakest stop that isn't an anchor does, and freed slots are
 * refilled from the ranking. A hometown no stop can reach within the leg cap is left off and `reason` says so.
 */
export async function keepHome<T extends Candidate>(opts: { from: Point; stops: T[]; ranked: T[]; shows: number; usable: (c: T) => Promise<boolean>; radius?: number; max?: number; rank?: number }): Promise<{ stops: T[]; home: T | null; out: T[]; added: boolean; reason?: string }> {
  const radius = opts.radius ?? RADIUS_KM;
  const max = opts.max ?? MAX_LEG_KM;
  const home = homeCity(opts.from, opts.ranked, opts.rank);
  if (!home) return { stops: opts.stops, home: null, out: [], added: false };
  if (opts.stops.some((s) => s.id === home.id)) return { stops: opts.stops, home, out: [], added: false };
  const near = opts.stops.filter((s) => tooClose(s, home, radius));
  const weakest = opts.stops.filter((s) => !isAnchor(s) && !near.includes(s)).sort((a, b) => b.rank - a.rank)[0];
  const gone = opts.stops.length - near.length >= opts.shows && weakest ? [...near, weakest] : near;
  const stay = opts.stops.filter((s) => !gone.includes(s));
  if (stay.length && !stay.some((s) => legCost(home, s) <= max)) return { stops: opts.stops, home, out: [], added: false, reason: `no other stop is within ${max.toLocaleString("en-US")} km of ${home.name ?? home.id}` };
  if (!(await opts.usable(home))) return { stops: opts.stops, home, out: [], added: false, reason: `no room in ${home.name ?? home.id} fits` };
  const out = [...stay, home];
  for (const c of opts.ranked) {
    if (out.length >= opts.shows) break;
    if (out.some((s) => s.id === c.id || tooClose(s, c, radius))) continue;
    if (await opts.usable(c)) out.push(c);
  }
  return { stops: out, home, out: gone, added: true };
}

/* ───────────── the leg rule ───────────── */

/**
 * The leg rule: no leg between two shows longer than `max` road km. The order is searched exactly first
 * (orderStops), so a city is only swapped out when no order of the stops keeps every leg under the cap. Then:
 * when the stops fall into groups that can't reach each other (a West Coast run and an East Coast run), the
 * strongest group is kept (by weight: an anchor market counts more, and a group the band can reach from the
 * starting city gets a little extra) and each stop outside it is replaced by the strongest city in the pool that
 * joins the kept group and has rooms. Any long leg left over is broken by swapping one of its two ends for a city
 * that leaves fewer long legs, keeping the higher-ranked end. A city is only tried when `usable` says it has
 * rooms, and at most `maxTries` cities are tried per swap, so the lookups stay bounded. Stops `keep` marks (the
 * hometown) are never swapped out. With `kmPerShow`, the run is then tightened toward that much road per show
 * (tightenRun) and `tradeOff` says what it gave up. Whatever can't be fixed stays, and the day sheet says so.
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
  keep?: (c: T) => boolean;
  first?: string;
  kmPerShow?: number;
}): Promise<{ stops: T[]; swaps: LegSwap<T>[]; tradeOff?: TradeOff<T> | null }> {
  const max = opts.max ?? MAX_LEG_KM;
  const weight = opts.weight ?? (() => 1);
  const maxTries = opts.maxTries ?? 5;
  const keep = opts.keep ?? (() => false);
  const order = (list: T[]) => orderStops(opts.from, list, { max, first: opts.first });
  let stops = [...opts.stops];
  const swaps: LegSwap<T>[] = [];
  const tried = new Map<string, boolean>();
  const usable = async (c: T) => {
    if (!tried.has(c.id)) tried.set(c.id, await opts.usable(c));
    return tried.get(c.id)!;
  };
  const used = (c: T) => stops.some((s) => s.id === c.id);
  const clashes = (c: T, except?: T) => stops.some((s) => s !== except && tooClose(s, c, opts.radius));

  // 0. An order with every leg under the cap: nothing to swap.
  if (longLegs(opts.from, order(stops), max).length) {
    // 1. Groups that can't reach each other: keep the strongest, pull the rest into it.
    const groups = legGroups(stops, max);
    if (groups.length > 1) {
      const score = (g: T[]) => (g.some(keep) ? 1e3 : 0) + g.reduce((n, c) => n + weight(c), 0) + (g.some((c) => legCost(opts.from, c) <= max) ? 0.5 : 0) - g.reduce((n, c) => n + c.rank, 0) / 1e6;
      const kept = [...groups].sort((a, b) => score(b) - score(a))[0]!;
      const outside = stops.filter((s) => !kept.includes(s) && !keep(s)).sort((a, b) => b.rank - a.rank);
      for (const far of outside) {
        let tries = 0;
        for (const c of opts.pool) {
          if (tries >= maxTries) break;
          if (used(c) || clashes(c, far) || !kept.some((k) => legCost(k, c) <= max)) continue;
          tries++;
          if (!(await usable(c))) continue;
          const km = Math.min(...kept.map((k) => legCost(k, far)));
          stops = stops.map((s) => (s === far ? c : s));
          kept.push(c);
          swaps.push({ out: far, in: c, km, reason: "leg" });
          break;
        }
      }
    }

    // 2. Long legs left over (no order of these stops avoids them): swap one end for a city that leaves fewer.
    const badness = (list: T[]) => {
      const long = longLegs(opts.from, order(list), max);
      return { n: long.length, worst: Math.max(0, ...long.map((l) => l.km)) };
    };
    for (let round = 0; round < (opts.maxSwaps ?? 4); round++) {
      const ordered = order(stops);
      const long = longLegs(opts.from, ordered, max);
      if (!long.length) break;
      const worst = long.reduce((a, b) => (b.km > a.km ? b : a));
      const now = badness(stops);
      const ends = [ordered[worst.index - 1]!, ordered[worst.index]!].filter((e) => !keep(e));
      const options: { end: T; c: T; n: number; worst: number }[] = [];
      for (const end of ends) {
        for (const c of opts.pool) {
          if (used(c) || clashes(c, end)) continue;
          const b = badness(stops.map((s) => (s === end ? c : s)));
          if (b.n < now.n || (b.n === now.n && b.worst < now.worst - 1)) options.push({ end, c, ...b });
        }
      }
      // Fewest long legs first; then keep the higher-ranked end (never trade the artist's #1 when swapping the
      // other end works); then the strongest replacement; then the shorter worst leg.
      options.sort((a, b) => a.n - b.n || b.end.rank - a.end.rank || a.c.rank - b.c.rank || a.worst - b.worst);
      let done = false;
      for (const o of options.slice(0, maxTries)) {
        if (!(await usable(o.c))) continue;
        stops = stops.map((s) => (s === o.end ? o.c : s));
        swaps.push({ out: o.end, in: o.c, km: worst.km, reason: "leg" });
        done = true;
        break;
      }
      if (!done) break;
    }
  }

  if (opts.kmPerShow === undefined) return { stops, swaps };
  const tight = await tightenRun({ from: opts.from, stops, pool: opts.pool, usable, kmPerShow: opts.kmPerShow, weight: opts.weight, max, radius: opts.radius, keep: opts.keep, first: opts.first, maxTries });
  return { stops: tight.stops, swaps: [...swaps, ...tight.swaps], tradeOff: tight.tradeOff };
}

/* ───────────── the shape of a run: km per show ───────────── */

const strength = (c: { rank: number }) => 1 / Math.sqrt(Math.max(1, c.rank));
/** Fan strength one show's worth of road (kmPerShow km) is worth, when trading a far city for a near one. */
const KM_VALUE = 0.25;

/** The extra road (km) of putting `c` into the route at its cheapest place. */
function insertion(from: Point, ordered: Point[], c: Point): number {
  let best = Infinity;
  for (let i = 0; i <= ordered.length; i++) {
    const prev = i ? ordered[i - 1]! : from;
    const next = ordered[i];
    const d = travel(prev, c).km + (next ? travel(c, next).km - travel(prev, next).km : 0);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Picks a regional run of `shows` cities (for runs of CLUSTER_MAX_SHOWS or fewer): for each of the strongest few
 * cities as a seed, it adds the strongest city that keeps the run within `kmPerShow` road km per show (the drive
 * from home included) and every leg under `max`, or the nearest city when none does; the run with the most fan
 * strength, less a penalty for every km over the target, wins. `must` cities (the hometown, anchors) are always in.
 * Longer runs get the strongest cities that clear the radius. The result keeps the order of `ranked`.
 */
export function clusterCities<T extends Candidate>(from: Point, ranked: T[], shows: number, opts: { kmPerShow?: number; max?: number; radius?: number; weight?: (c: T) => number; seeds?: number; must?: T[] } = {}): T[] {
  const target = opts.kmPerShow ?? KM_PER_SHOW_VAN;
  const max = opts.max ?? MAX_LEG_KM;
  const weight = opts.weight ?? strength;
  const must = opts.must ?? [];
  const byRank = (list: T[]) => [...list].sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
  const fits = (set: T[], c: T) => !set.some((s) => s.id === c.id || tooClose(s, c, opts.radius));
  if (shows > CLUSTER_MAX_SHOWS) {
    const out = [...must];
    for (const c of ranked) if (out.length < shows && fits(out, c)) out.push(c);
    return byRank(out);
  }
  const route = (set: T[]) => orderStops(from, set, { max });
  const total = (set: T[]) => pathKm(from, route(set));
  const seeds = ranked.filter((c) => fits(must, c)).slice(0, opts.seeds ?? 5);
  let best: { set: T[]; score: number } | null = null;
  for (const seed of seeds.length ? seeds : [null]) {
    const set = [...must, ...(seed ? [seed] : [])].slice(0, shows);
    while (set.length < shows) {
      const ordered = route(set);
      const now = pathKm(from, ordered);
      const out = set.length ? travel(from, ordered[0]!).km : 0;
      let pick: { c: T; ins: number; ok: boolean } | null = null;
      for (const c of ranked) {
        if (!fits(set, c)) continue;
        const ins = insertion(from, ordered, c);
        const near = !set.length || set.some((s) => legCost(s, c) <= max);
        const ok = near && now + ins <= target * (set.length + 1) + out;
        // The strongest city that keeps the run tight; failing that, the one that adds the least road.
        if (!pick || (ok && !pick.ok) || (ok && pick.ok && weight(c) > weight(pick.c)) || (!ok && !pick.ok && ins < pick.ins)) pick = { c, ins, ok };
      }
      if (!pick) break;
      set.push(pick.c);
    }
    const t = total(set);
    const score = set.reduce((n, c) => n + weight(c), 0) - Math.max(0, t / Math.max(1, set.length) - target) / target - longLegs(from, route(set), max).length;
    if (!best || score > best.score) best = { set, score };
  }
  return byRank(best?.set ?? []);
}

/**
 * Tightens a run toward `kmPerShow` road km per show (KM_PER_SHOW_VAN by default, for a van run): while the run
 * is over the target, the stop whose removal saves the most road is swapped for the nearby pool city that saves
 * the most road for the least fan strength (a swap must save 5% of the run and add no long leg). Anchors and
 * `keep` stops stay. Returns the swaps and the trade-off in words for the tour book.
 */
export async function tightenRun<T extends Candidate>(opts: {
  from: Point;
  stops: T[];
  pool: T[];
  usable: (c: T) => Promise<boolean>;
  kmPerShow?: number;
  weight?: (c: T) => number;
  max?: number;
  radius?: number;
  keep?: (c: T) => boolean;
  first?: string;
  maxSwaps?: number;
  maxTries?: number;
}): Promise<{ stops: T[]; swaps: LegSwap<T>[]; tradeOff: TradeOff<T> | null }> {
  const target = opts.kmPerShow ?? KM_PER_SHOW_VAN;
  const max = opts.max ?? MAX_LEG_KM;
  const weight = opts.weight ?? strength;
  const keep = (c: T) => isAnchor(c) || (opts.keep?.(c) ?? false);
  const route = (list: T[]) => orderStops(opts.from, list, { max, first: opts.first });
  let stops = [...opts.stops];
  const swaps: LegSwap<T>[] = [];
  for (let round = 0; round < (opts.maxSwaps ?? 3); round++) {
    const ordered = route(stops);
    const now = pathKm(opts.from, ordered);
    if (!stops.length || now / stops.length <= target) break;
    const nLong = longLegs(opts.from, ordered, max).length;
    const saving = (i: number) => {
      const prev = i ? ordered[i - 1]! : opts.from;
      const s = ordered[i]!;
      const next = ordered[i + 1];
      return travel(prev, s).km + (next ? travel(s, next).km - travel(prev, next).km : 0);
    };
    const outs = ordered
      .map((s, i) => ({ s, save: saving(i) }))
      .filter((x) => !keep(x.s))
      .sort((a, b) => b.save - a.save)
      .slice(0, 3)
      .map((x) => x.s);
    const options: { out: T; c: T; saved: number; value: number }[] = [];
    for (const out of outs) {
      const rest = stops.filter((s) => s !== out);
      const restOrdered = route(rest);
      const near = opts.pool
        .filter((c) => !stops.some((s) => s.id === c.id) && !rest.some((s) => tooClose(s, c, opts.radius)))
        .map((c) => ({ c, ins: insertion(opts.from, restOrdered, c) }))
        .sort((a, b) => a.ins - b.ins)
        .slice(0, 8);
      for (const { c } of near) {
        const list = stops.map((s) => (s === out ? c : s));
        const ord = route(list);
        const saved = now - pathKm(opts.from, ord);
        if (saved < now * 0.05 || longLegs(opts.from, ord, max).length > nLong) continue;
        const value = (saved / target) * KM_VALUE - (weight(out) - weight(c));
        if (value > 0) options.push({ out, c, saved, value });
      }
    }
    options.sort((a, b) => b.value - a.value);
    let done = false;
    for (const o of options.slice(0, opts.maxTries ?? 5)) {
      if (!(await opts.usable(o.c))) continue;
      stops = stops.map((s) => (s === o.out ? o.c : s));
      swaps.push({ out: o.out, in: o.c, km: Math.round(o.saved), reason: "km-per-show" });
      done = true;
      break;
    }
    if (!done) break;
  }
  return { stops, swaps, tradeOff: swaps.length ? describeTradeOff(opts.from, opts.stops, stops, { max, first: opts.first }) : null };
}

/** What a change of cities gives up and gains, in a booker's words ("Dropping Austin and Santa Fe saves 2,900 km and 4 dark days"). */
export type TradeOff<T> = { dropped: T[]; added: T[]; kmSaved: number; darkDaysSaved: number; before: { km: number; darkDays: number }; after: { km: number; darkDays: number }; text: string };

const names = (list: { name?: string; id?: string }[]) => {
  const n = list.map((c) => c.name ?? c.id ?? "?");
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
};
const roundKm = (v: number) => (v >= 1000 ? Math.round(v / 100) * 100 : Math.round(v / 10) * 10).toLocaleString("en-US");

/**
 * The trade-off between two versions of a run, each routed the usual way: road km (the drive from home
 * included) and dark days (days between shows with no show: travel days and days off).
 */
export function describeTradeOff<T extends Candidate>(from: Point, before: T[], after: T[], opts: OrderOptions = {}): TradeOff<T> {
  const shape = (list: T[]) => {
    const ordered = orderStops(from, list, opts);
    const legs = schedule(from, ordered, "2027-01-04");
    return { km: pathKm(from, ordered), darkDays: legs.reduce((n, l) => n + l.travelDays, 0) };
  };
  const b = shape(before);
  const a = shape(after);
  const dropped = before.filter((s) => !after.some((x) => x.id === s.id));
  const added = after.filter((s) => !before.some((x) => x.id === s.id));
  const kmSaved = b.km - a.km;
  const darkDaysSaved = b.darkDays - a.darkDays;
  const days = (n: number) => `${n} dark day${n === 1 ? "" : "s"}`;
  const head = dropped.length ? `Dropping ${names(dropped)}${added.length ? ` for ${names(added)}` : ""}` : added.length ? `Adding ${names(added)}` : "The same cities";
  const road = kmSaved >= 0 ? `saves ${roundKm(kmSaved)} km` : `adds ${roundKm(-kmSaved)} km`;
  const dark = darkDaysSaved > 0 ? (kmSaved >= 0 ? ` and ${days(darkDaysSaved)}` : `, saves ${days(darkDaysSaved)}`) : darkDaysSaved < 0 ? `${kmSaved >= 0 ? ", but adds" : " and"} ${days(-darkDaysSaved)}` : "";
  return { dropped, added, kmSaved, darkDaysSaved, before: b, after: a, text: `${head} ${road}${dark}` };
}

/* ───────────── one country, not the whole run ───────────── */

/** No country gets more than about this share of a multi-country (mainland Europe) run's dates. */
export const COUNTRY_CAP = 0.4;
/** The most dates one country may take on a run of `n`: about COUNTRY_CAP of them, never fewer than 2. */
export const countryMax = (n: number, share: number = COUNTRY_CAP) => Math.max(2, Math.round(share * n));

/** Dates per country, and the countries over the cap. */
export function countryCheck(stops: Point[], share: number = COUNTRY_CAP): { counts: Record<string, number>; over: { cc: string; n: number; max: number }[] } {
  const counts: Record<string, number> = {};
  for (const s of stops) {
    const cc = countryOf(s) ?? "?";
    counts[cc] = (counts[cc] ?? 0) + 1;
  }
  const max = countryMax(stops.length, share);
  return { counts, over: Object.entries(counts).filter(([, n]) => n > max).map(([cc, n]) => ({ cc, n, max })) };
}

/**
 * The country cap: while one country has more than about 40% of the dates (Ghost playing 6 of 8 in Germany), its
 * weakest stop gives way to the strongest pool city in a country under the cap that clears the radius, adds no
 * long leg and has rooms. Anchors and `keep` stops stay. Meant for mainland Europe runs (a UK or US run is one
 * country by design).
 */
export async function capCountries<T extends Candidate>(opts: { from: Point; stops: T[]; pool: T[]; usable: (c: T) => Promise<boolean>; share?: number; max?: number; radius?: number; keep?: (c: T) => boolean; first?: string; maxTries?: number }): Promise<{ stops: T[]; swaps: LegSwap<T>[] }> {
  const max = opts.max ?? MAX_LEG_KM;
  const keep = (c: T) => isAnchor(c) || (opts.keep?.(c) ?? false);
  const cap = countryMax(opts.stops.length, opts.share);
  const longs = (list: T[]) => longLegs(opts.from, orderStops(opts.from, list, { max, first: opts.first }), max).length;
  let stops = [...opts.stops];
  const swaps: LegSwap<T>[] = [];
  const rejected = new Set<string>();
  for (let round = 0; round < opts.stops.length; round++) {
    const { counts, over } = countryCheck(stops, opts.share);
    const worst = over.sort((a, b) => b.n - a.n)[0];
    if (!worst) break;
    const out = stops.filter((s) => countryOf(s) === worst.cc && !keep(s) && !rejected.has(s.id)).sort((a, b) => b.rank - a.rank)[0];
    if (!out) break;
    const now = longs(stops);
    let tries = 0;
    let done = false;
    for (const c of opts.pool) {
      if (tries >= (opts.maxTries ?? 5)) break;
      const cc = countryOf(c) ?? "?";
      if (cc === worst.cc || (counts[cc] ?? 0) + 1 > cap) continue;
      if (stops.some((s) => s.id === c.id || (s !== out && tooClose(s, c, opts.radius)))) continue;
      const list = stops.map((s) => (s === out ? c : s));
      if (longs(list) > now) continue;
      tries++;
      if (!(await opts.usable(c))) continue;
      stops = list;
      swaps.push({ out, in: c, km: 0, reason: "country" });
      done = true;
      break;
    }
    if (!done) rejected.add(out.id);
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
  /** Road km driven from the previous stop (round a gulf where the road goes round; a ferry's sea miles not counted). */
  fromKm: number;
  /** Hours door to door: driving, plus any sailing, check-in and border time. */
  fromHours: number;
  /** Days with no show just before this one: travel days and days off. */
  travelDays: number;
  dayOff: boolean;
  /** The ferry this leg takes, with its hours (sailing and check-in), for the day sheet. */
  ferry?: { name: string; hours: number };
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
    const t = travel(prev, stop);
    const h = Math.round(t.hours * 10) / 10;
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
    legs.push({ stop, date, nights, fromKm: t.km, fromHours: h, travelDays, dayOff, ...(t.ferry ? { ferry: t.ferry } : {}) });
    prev = stop;
  });
  return legs;
}

export { addDays };
