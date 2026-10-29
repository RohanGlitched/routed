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
  for (const k of ["neighbourhood", "quarter", "suburb", "city_district", "borough", "hamlet"] as const) {
    const v = address[k]?.trim();
    if (!v || v.length > 40) continue;
    const f = fold(v);
    // "City of Nashville", "Nashville" or a county are no answer; "Downtown Nashville" is one.
    if (!f || f === c || f === `city of ${c}` || /\bcounty\b/.test(f)) continue;
    return v;
  }
  return undefined;
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
