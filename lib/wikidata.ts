import "server-only";
import { sameVenue } from "./agent/capacity";
import { kmBetween } from "./geo/local";

/**
 * Room capacities from Wikidata (property P1083, "maximum capacity"), which carries most theatres, ballrooms,
 * amphitheatres and arenas and needs no key. A match must be the room itself (not a hall inside it), sit within
 * 30 km of the city when Wikidata has coordinates, or name the city in its description. Clubs Wikidata doesn't
 * know fall through to the web (lib/web.ts).
 *
 * Wikidata rate-limits shared serverless addresses, so requests go through a small gate (two in flight) and a
 * 429 or 5xx is retried with backoff. A lookup that failed is reported as `undefined` (try again later), never as
 * "not found": a failure stored as "not found" once hid 3Olympia's and O2 Academy Bristol's capacities.
 */
const UA = "Routed/1.0 (tour routing demo; https://routed-tours.vercel.app)";
const API = "https://www.wikidata.org";

type Hit = { id: string; label: string; description?: string };
type Claims = Record<string, { mainsnak?: { datavalue?: { value?: { amount?: string; latitude?: number; longitude?: number } } } }[]>;

export type WikiCapacity = { value: number; source: string; quote: string };

const memo = new Map<string, WikiCapacity | null>();

const MAX_IN_FLIGHT = 1;
const GAP_MS = 250;
let inFlight = 0;
let lastStart = 0;
const waiting: (() => void)[] = [];

async function getJson<T>(url: string): Promise<T> {
  let last: Error = new Error("Wikidata didn't answer");
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 1) + Math.random() * 300));
    while (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
    inFlight++;
    const wait = lastStart + GAP_MS - Date.now();
    lastStart = Math.max(Date.now(), lastStart + GAP_MS);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    let status = 0;
    let retryAfter = 0;
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (r.ok) return (await r.json()) as T;
      status = r.status;
      retryAfter = Math.min(5, Number(r.headers.get("retry-after")) || 0);
      last = new Error(`HTTP ${r.status}`);
    } catch (e) {
      last = e as Error;
    } finally {
      inFlight--;
      waiting.shift()?.();
    }
    if (status && status !== 429 && status < 500) break;
    if (retryAfter) await new Promise((r) => setTimeout(r, retryAfter * 1000));
  }
  throw last;
}

/** The capacity; null when Wikidata answered and has none for this room; undefined when it couldn't be asked. */
export async function wikidataCapacity(venue: string, city: string, near?: { lat: number; lon: number }): Promise<WikiCapacity | null | undefined> {
  const key = `${venue}|${city}`.toLowerCase();
  if (memo.has(key)) return memo.get(key)!;
  let out: WikiCapacity | null = null;
  try {
    const hits: Hit[] = [];
    // The bare name first; then the name with the city ("Olympia Theatre Dublin") for rooms whose label carries it.
    for (const search of [venue, `${venue} ${city.split(",")[0]!.trim()}`]) {
      const q = new URLSearchParams({ action: "wbsearchentities", search, language: "en", limit: "4", format: "json", origin: "*" });
      const s = await getJson<{ search?: Hit[] }>(`${API}/w/api.php?${q}`);
      for (const h of s.search ?? []) if (!hits.some((x) => x.id === h.id)) hits.push(h);
      if (hits.length) break;
    }
    const likely = hits.filter((h) => sameVenue(venue, h.label, h.description));
    // One request for every likely item's claims, not one per item.
    const e = likely.length ? await getJson<{ entities?: Record<string, { claims?: Claims }> }>(`${API}/w/api.php?${new URLSearchParams({ action: "wbgetentities", ids: likely.map((h) => h.id).join("|"), props: "claims", format: "json", origin: "*" })}`) : { entities: {} };
    for (const h of likely) {
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
    return undefined;
  }
  memo.set(key, out);
  if (memo.size > 3000) memo.delete(memo.keys().next().value!);
  return out;
}
