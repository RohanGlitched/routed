import "server-only";
import { mergeCapacities, NOT_A_SOURCE, pickCapacity, sameVenue } from "./agent/capacity";
import { storage } from "./storage";
import { wikidataCapacity } from "./wikidata";

/**
 * Tavily, for the one fact Qloo doesn't carry: how many people a room holds. Search returns page snippets; the
 * capacity is read out of them by rule (agent/capacity.ts) with its quote and source kept.
 */
const API = "https://api.tavily.com";

/**
 * Routed searches in Tavily's keyless mode by default, so it spends none of the account's monthly credits (another
 * project relies on them). TAVILY_USE_KEY=1 switches to the key. Either way at most WEB_DAILY_CAP searches a day
 * per server instance, on top of the shared cache below.
 */
const USE_KEY = process.env.TAVILY_USE_KEY === "1" && Boolean(process.env.TAVILY_API_KEY);
const WEB_DAILY_CAP = Number(process.env.WEB_DAILY_CAP || 60);
let webDay = "";
let webCount = 0;

export const hasTavily = () => process.env.TAVILY_OFF !== "1";

function takeSearch(): boolean {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== webDay) {
    webDay = d;
    webCount = 0;
  }
  if (webCount >= WEB_DAILY_CAP) return false;
  webCount++;
  return true;
}

type Cap = { value: number; source: string; quote: string };

/**
 * One number per room, everywhere: every answer, found or not, is remembered under the room's Qloo id, in memory
 * and in one private index in storage that every instance re-reads every couple of minutes. The first answer
 * stored for a room wins, so two tours never show the same room with two capacities (Wonder Ballroom once read
 * 778 on one tour and 3,000 on another). The index was started again on Oct 15 when the page reader got
 * stricter; of the older index (answers stored by name and city) only Wikidata answers re-checked against the
 * room are still read.
 */
const memo = new Map<string, Cap | null>();
/** Bumped whenever the page reader changes, so answers read by an older reader are never trusted again. */
export const READER_VERSION = 3;
const INDEX = `capacity/rooms-v${READER_VERSION}.json`;
const LEGACY_INDEX = "capacity/index.json";
const legacy = new Map<string, Cap>();
let legacyLoaded: Promise<void> | null = null;
const RELOAD_MS = 120_000;
let loaded: Promise<void> | null = null;
let loadedAt = 0;
let dirty = false;
let flushing: ReturnType<typeof setTimeout> | null = null;

const useBlob = () => storage() !== null;

/** A stored answer from a source Routed no longer trusts (social posts, an article about a planned building). */
const distrusted = (c: Cap | null | undefined) => Boolean(c && (NOT_A_SOURCE.test(c.source) || /planned|proposed|new-venue|will-open/i.test(c.source)));
/** An older Wikidata answer, re-checked against the venue: its quote is "Label: description; maximum capacity …". */
function stillTrusted(c: Cap, venue: string): boolean {
  if (distrusted(c)) return false;
  if (!c.source.includes("wikidata.org")) return true;
  const head = c.quote.split("; maximum capacity")[0] ?? "";
  const [label, ...rest] = head.split(": ");
  return sameVenue(venue, label ?? "", rest.join(": "));
}

function load(): Promise<void> {
  if (!useBlob()) return Promise.resolve();
  legacyLoaded ??= (async () => {
    const r = await storage()!.read(LEGACY_INDEX).catch(() => null);
    if (!r) return;
    for (const [k, v] of Object.entries(JSON.parse(r.text) as Record<string, Cap | null>)) if (v && v.source.includes("wikidata.org")) legacy.set(k, v);
  })().catch(() => {});
  if (loaded && Date.now() - loadedAt < RELOAD_MS) return loaded;
  loadedAt = Date.now();
  loaded = (async () => {
    const r = await storage()!.read(INDEX).catch(() => null);
    if (!r) return;
    const j = JSON.parse(r.text) as Record<string, Cap | null>;
    // A stored number is the truth for its room (first writer wins). A stored "not found" is ignored: it may have
    // been a lookup that failed, and the room is asked again.
    for (const [k, v] of Object.entries(j)) if (v && !distrusted(v)) memo.set(k, v);
  })().catch(() => {});
  return Promise.all([loaded, legacyLoaded]).then(() => {});
}

function scheduleFlush() {
  if (!useBlob()) return;
  dirty = true;
  if (flushing) return;
  flushing = setTimeout(async () => {
    flushing = null;
    if (!dirty) return;
    dirty = false;
    // Merge with what other instances wrote since this one loaded.
    const r = await storage()!.read(INDEX).catch(() => null);
    const theirs = r ? (JSON.parse(r.text) as Record<string, Cap | null>) : {};
    // Keep what another instance already stored for a room, unless it found nothing and this one did.
    const all = mergeCapacities(Object.fromEntries(memo), theirs);
    for (const [k, v] of Object.entries(all)) if (v) memo.set(k, v);
    const found = Object.fromEntries(Object.entries(all).filter(([, v]) => v));
    await storage()!.write(INDEX, JSON.stringify(found)).catch((e) => console.error("[capacity] cache write failed", e));
  }, 4000);
}

/** How many a room holds: `city` is the label ("Portland, OR"), so two Portlands never share an answer. */
export async function roomCapacity(room: { id: string; name: string; lat?: number; lon?: number }, city: string): Promise<Cap | null> {
  const venue = room.name;
  const near = room.lat !== undefined && room.lon !== undefined ? { lat: room.lat, lon: room.lon } : undefined;
  const key = `id:${room.id}`;
  const old = `${venue}|${city.split(",")[0]!.trim()}`.toLowerCase();
  await load();
  if (memo.has(key)) return memo.get(key)!;
  const kept = legacy.get(key) ?? legacy.get(old);
  if (kept && stillTrusted(kept, venue)) {
    memo.set(key, kept);
    scheduleFlush();
    return kept;
  }
  // Wikidata knows most theatres, ballrooms, amphitheatres and arenas, exactly and for free.
  const wiki = await wikidataCapacity(venue, city, near);
  if (wiki) {
    memo.set(key, wiki);
    scheduleFlush();
    return wiki;
  }
  if (!hasTavily() || !takeSearch()) return null;
  let r: Response;
  try {
    r = await fetch(`${API}/search`, {
      method: "POST",
      headers: USE_KEY ? { authorization: `Bearer ${process.env.TAVILY_API_KEY}`, "content-type": "application/json" } : { "x-tavily-access-mode": "keyless", "content-type": "application/json" },
      body: JSON.stringify({ query: `${venue} ${city} venue capacity`, search_depth: "basic", max_results: 5, include_answer: false }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return null;
  }
  if (!r.ok) {
    console.error(`[tavily] HTTP ${r.status}`);
    return null;
  }
  const j = (await r.json()) as { results?: { url: string; title: string; content: string }[] };
  const pages = (j.results ?? []).map((x) => ({ url: x.url, text: `${x.title}\n${x.content}` }));
  const cap = pickCapacity(venue, pages, city);
  // "Not found" is remembered in this instance only when both sources really answered.
  if (cap || wiki === null) memo.set(key, cap);
  if (cap) scheduleFlush();
  return cap;
}
