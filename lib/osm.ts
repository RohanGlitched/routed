/**
 * The neighbourhood a point sits in, from OpenStreetMap (Nominatim reverse geocoding), for a stop whose hottest
 * blocks Qloo's places name no neighbourhood for. One request a stop at most, one a second across the app
 * (Nominatim's usage policy), with a plain user agent and a short timeout; a failure names nothing.
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */

export const OSM_CREDIT = "© OpenStreetMap contributors";
export const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";
const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const UA = "Routed tour planner (https://routed-tours.vercel.app; https://github.com/RohanGlitched/routed)";
const GAP_MS = 1100;

type Address = Partial<Record<"neighbourhood" | "quarter" | "suburb" | "city_district" | "borough" | "hamlet" | "city" | "town" | "village", string>>;

/** The most local name in a Nominatim address that isn't the city itself: neighbourhood, then quarter, suburb,
 *  district. Pure, for tests. */
export function neighbourhoodOf(address: Address | undefined, city: string): string | undefined {
  if (!address) return undefined;
  const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const c = fold(city);
  // Administrative units and housing estates aren't neighbourhoods a booker would name ("Ward 2", "North City ED",
  // "The Estates at Wiedemann Mansion").
  const BAD = /\d|\bward\b|\bed\b|\bestates?\b|\bmansion\b|\bapartments?\b|\bcondo|\bsubdivision\b|\bhomes\b|\belectoral\b|\bdistrict of\b/;
  const ok = (v?: string) => {
    const f = v ? fold(v) : "";
    return Boolean(v && v.length <= 40 && f && f !== c && f !== `city of ${c}` && !/\bcounty\b/.test(f) && !BAD.test(f));
  };
  const local = (["neighbourhood", "quarter", "suburb", "city_district", "borough"] as const).map((k) => address[k]?.trim()).find(ok);
  // The hottest blocks across a city line (Cambridge for Boston, Newport across the river from Cincinnati): the town
  // is the answer, with its own neighbourhood when it has one.
  const town = address.city ?? address.town ?? address.village;
  if (town && fold(town) !== c && ok(town)) {
    const inner = (["suburb", "quarter"] as const).map((k) => address[k]?.trim()).find(ok);
    return inner ? `${inner}, ${town}` : town;
  }
  return local;
}

let last = 0;
let chain: Promise<unknown> = Promise.resolve();

/** One reverse lookup, spaced from the last one; undefined when Nominatim doesn't answer in time or names nothing. */
export function osmNeighbourhood(lat: number, lon: number, city: string, timeoutMs = 5000): Promise<string | undefined> {
  const run = async () => {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const url = `${ENDPOINT}?format=jsonv2&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=16&addressdetails=1`;
      const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en" }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return undefined;
      const j = (await res.json()) as { address?: Address };
      return neighbourhoodOf(j.address, city);
    } catch {
      return undefined;
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

/** The ring searched when the hottest tile itself sits in no named neighbourhood (a river, a rail yard). */
export const RING_M = 500;

/**
 * The neighbourhood for a hot tile: the one OpenStreetMap puts the tile in, else the name most of the points
 * RING_M around it fall in (Asheville's hottest tile is on a street between South Slope and the River Arts
 * District), with how far that is, so the page says "nearest". `samples` points on the ring (4 or 8).
 */
export async function osmNeighbourhoodNear(lat: number, lon: number, city: string, samples = 8): Promise<{ name: string; km?: number } | undefined> {
  const at = await osmNeighbourhood(lat, lon, city);
  if (at) return { name: at };
  const dLat = RING_M / 111_000, dLon = RING_M / (111_000 * Math.cos((lat * Math.PI) / 180));
  const tally = new Map<string, number>();
  for (let i = 0; i < samples; i++) {
    const a = (2 * Math.PI * i) / samples;
    const name = await osmNeighbourhood(lat + dLat * Math.cos(a), lon + dLon * Math.sin(a), city);
    if (name) tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  const best = [...tally.entries()].sort((x, y) => y[1] - x[1])[0];
  return best ? { name: best[0], km: RING_M / 1000 } : undefined;
}
