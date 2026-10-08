import "server-only";
import { kmBetween } from "./geo/local";

/**
 * Room capacities from Wikidata (property P1083, "maximum capacity"), which carries most theatres, ballrooms,
 * amphitheatres and arenas, needs no key and isn't rate limited the way web search is. A match must sit within
 * 30 km of the city when Wikidata has coordinates, or name the city in its description; otherwise it is not
 * this room. Clubs Wikidata doesn't know fall through to the web (lib/web.ts).
 */
const UA = "Routed/1.0 (tour routing demo; https://routed-tours.vercel.app)";
const API = "https://www.wikidata.org";

type Hit = { id: string; label: string; description?: string };
type Claims = Record<string, { mainsnak?: { datavalue?: { value?: { amount?: string; latitude?: number; longitude?: number } } } }[]>;

export type WikiCapacity = { value: number; source: string; quote: string };

const memo = new Map<string, WikiCapacity | null>();

export async function wikidataCapacity(venue: string, city: string, near?: { lat: number; lon: number }): Promise<WikiCapacity | null> {
  const key = `${venue}|${city}`.toLowerCase();
  if (memo.has(key)) return memo.get(key)!;
  let out: WikiCapacity | null = null;
  try {
    const hits: Hit[] = [];
    // The bare name first; then the name with the city ("Olympia Theatre Dublin") for rooms whose label carries it.
    for (const search of [venue, `${venue} ${city.split(",")[0]!.trim()}`]) {
      const q = new URLSearchParams({ action: "wbsearchentities", search, language: "en", limit: "4", format: "json", origin: "*" });
      const s = (await fetch(`${API}/w/api.php?${q}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) }).then((r) => r.json())) as { search?: Hit[] };
      for (const h of s.search ?? []) if (!hits.some((x) => x.id === h.id)) hits.push(h);
      if (hits.length) break;
    }
    for (const h of hits) {
      const e = (await fetch(`${API}/wiki/Special:EntityData/${h.id}.json`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) }).then((r) => r.json())) as { entities?: Record<string, { claims?: Claims }> };
      const claims = e.entities?.[h.id]?.claims ?? {};
      const amount = claims.P1083?.[0]?.mainsnak?.datavalue?.value?.amount;
      if (!amount) continue;
      const value = Math.round(Number(amount));
      if (!(value >= 50 && value <= 120_000)) continue;
      const c = claims.P625?.[0]?.mainsnak?.datavalue?.value;
      const placed = near && c?.latitude !== undefined && c?.longitude !== undefined ? kmBetween(near, { lat: c.latitude, lon: c.longitude }) <= 30 : undefined;
      const named = (h.description ?? "").toLowerCase().includes(city.toLowerCase().split(",")[0]!.trim());
      if (placed === false || (placed === undefined && !named)) continue;
      out = { value, source: `https://www.wikidata.org/wiki/${h.id}`, quote: `${h.label}${h.description ? `: ${h.description}` : ""}; maximum capacity ${value.toLocaleString("en-US")} (Wikidata P1083)` };
      break;
    }
  } catch (e) {
    console.error("[wikidata] lookup failed", (e as Error).message);
  }
  memo.set(key, out);
  if (memo.size > 3000) memo.delete(memo.keys().next().value!);
  return out;
}
