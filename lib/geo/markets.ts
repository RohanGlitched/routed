import raw from "./cities.json";

/**
 * Touring markets: cities of 50k+ in North America, the UK and Ireland, 100k+ elsewhere in Europe (GeoNames,
 * CC BY 4.0), with suburbs folded into the city they play as. Built by scripts/build-cities.mjs.
 */
export type RegionId = "na" | "uk" | "eu";

export type Market = {
  name: string;
  ascii: string;
  cc: string;
  state: string;
  lat: number;
  lon: number;
  pop: number;
  region: RegionId;
};

type Row = [string, string, string, string, number, number, number, RegionId];

export const MARKETS: Market[] = (raw as Row[]).map(([name, ascii, cc, state, lat, lon, pop, region]) => ({ name, ascii, cc, state, lat, lon, pop, region }));

export const REGIONS: Record<RegionId, { name: string; poster: string; countries: string[] }> = {
  na: { name: "North America", poster: "North America", countries: ["US", "CA"] },
  uk: { name: "UK and Ireland", poster: "UK and Ireland", countries: ["GB", "IE"] },
  eu: { name: "Europe", poster: "Europe", countries: [] },
};

const COUNTRY: Record<string, string> = {
  US: "USA", CA: "Canada", GB: "UK", IE: "Ireland", DE: "Germany", FR: "France", NL: "Netherlands", BE: "Belgium", LU: "Luxembourg",
  ES: "Spain", PT: "Portugal", IT: "Italy", CH: "Switzerland", AT: "Austria", DK: "Denmark", SE: "Sweden", NO: "Norway", FI: "Finland",
  PL: "Poland", CZ: "Czechia", HU: "Hungary", SK: "Slovakia", SI: "Slovenia", HR: "Croatia", IS: "Iceland", EE: "Estonia", LV: "Latvia",
  LT: "Lithuania", GR: "Greece", RO: "Romania", BG: "Bulgaria", RS: "Serbia",
};

/** "Portland, OR", "Toronto, ON"-style label a booking agent would write; Europe gets the country. */
export function marketLabel(m: Market): string {
  if (m.cc === "US") return `${m.name}, ${m.state}`;
  if (m.cc === "CA") return `${m.name}, ${CA_ABBR[m.state] ?? m.state}`;
  return `${m.name}, ${COUNTRY[m.cc] ?? m.cc}`;
}

const CA_ABBR: Record<string, string> = {
  Ontario: "ON", Quebec: "QC", "British Columbia": "BC", Alberta: "AB", Manitoba: "MB", Saskatchewan: "SK", "Nova Scotia": "NS",
  "New Brunswick": "NB", "Newfoundland and Labrador": "NL", "Prince Edward Island": "PE",
};

/** A stable id for a market, used in URLs, records and tool calls ("portland-us-or"). */
export function marketId(m: Market): string {
  return [m.ascii, m.cc, m.cc === "US" ? m.state : ""].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const byId = new Map(MARKETS.map((m) => [marketId(m), m]));
export const marketById = (id: string) => byId.get(id);

export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The market a point belongs to: the nearest one within `maxKm`, preferring bigger cities at similar distance. */
export function nearestMarket(p: { lat: number; lon: number }, region?: RegionId, maxKm = 60): Market | null {
  let best: Market | null = null;
  let bestScore = Infinity;
  for (const m of MARKETS) {
    if (region && m.region !== region) continue;
    const d = km(p, m);
    if (d > maxKm) continue;
    // A city 3x bigger wins at up to ~11 km further away: tiles between a city and its satellite go to the city.
    const score = d - 10 * Math.log10(m.pop);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/** Lower case, no accents or punctuation, and "Saint"/"St.", "Fort"/"Ft." written one way, so "St. Louis" meets "Saint Louis". */
const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bsaint\b/g, "st")
    .replace(/\bsainte\b/g, "ste")
    .replace(/\bfort\b/g, "ft")
    .replace(/\bmount\b/g, "mt");

const ALIASES: Record<string, string> = {
  nyc: "new york", "new york city": "new york", brooklyn: "new york", manhattan: "new york", la: "los angeles", sf: "san francisco",
  philly: "philadelphia", dc: "washington", "washington dc": "washington", "washington d c": "washington", nola: "new orleans",
  vegas: "las vegas", atx: "austin", "st paul": "minneapolis", "twin cities": "minneapolis", "quebec city": "quebec", "kansas city mo": "kansas city",
};

/**
 * Finds the market someone typed: "Portland, OR", "portland oregon", "Montreal", "Brooklyn". When a name is
 * shared (Portland OR/ME, Manchester UK/NH), a state or country after a comma decides; otherwise the biggest wins.
 */
export function findMarket(text: string, region?: RegionId): Market | null {
  const [head, ...rest] = text.split(",");
  let name = fold(head ?? "");
  const qualifier = fold(rest.join(" "));
  name = ALIASES[name] ?? name;
  let candidates = MARKETS.filter((m) => (!region || m.region === region) && (fold(m.ascii) === name || fold(m.name) === name));
  if (!candidates.length) {
    // "portland oregon" with no comma: try trailing words as the qualifier.
    const words = name.split(" ");
    for (let i = words.length - 1; i > 0 && !candidates.length; i--) {
      const n = words.slice(0, i).join(" ");
      const q = words.slice(i).join(" ");
      const c = MARKETS.filter((m) => (!region || m.region === region) && fold(m.ascii) === (ALIASES[n] ?? n));
      const hit = c.filter((m) => matchesQualifier(m, q));
      if (hit.length) candidates = hit;
    }
  }
  // "Québec City", "Oklahoma City" (kept), "Mexico City": try without a trailing "city".
  if (!candidates.length && name.endsWith(" city")) {
    const n = name.slice(0, -5);
    candidates = MARKETS.filter((m) => (!region || m.region === region) && (fold(m.ascii) === n || fold(m.name) === n));
  }
  if (!candidates.length) return null;
  if (qualifier) {
    const hit = candidates.filter((m) => matchesQualifier(m, qualifier));
    if (hit.length) candidates = hit;
  }
  return candidates.sort((a, b) => b.pop - a.pop)[0] ?? null;
}

const US_STATES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", DC: "district of columbia",
  FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana",
  ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska",
  NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio",
  OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas",
  UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
};

function matchesQualifier(m: Market, q: string): boolean {
  if (!q) return true;
  const opts = [m.state, US_STATES[m.state] ?? "", CA_ABBR[m.state] ?? "", m.cc, COUNTRY[m.cc] ?? "", m.cc === "GB" ? "uk england scotland wales" : "", m.cc === "US" ? "usa us" : ""].map(fold);
  return opts.some((o) => o && (o === q || o.split(" ").includes(q)));
}
