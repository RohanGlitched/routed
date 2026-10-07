import "server-only";
import { get, put } from "@vercel/blob";
import { pickCapacity } from "./agent/capacity";

/**
 * Tavily, for the one fact Qloo doesn't carry: how many people a room holds. Search returns page snippets; the
 * capacity is read out of them by rule (agent/capacity.ts) with its quote and source kept.
 */
const API = "https://api.tavily.com";

export const hasTavily = () => Boolean(process.env.TAVILY_API_KEY);

type Cap = { value: number; source: string; quote: string };

/**
 * Searches cost credits (1,000 a month on the free plan), so every answer, found or not, is remembered: in
 * memory, and in one private blob read once per server instance, so a room is searched once, not once a tour.
 */
const memo = new Map<string, Cap | null>();
const INDEX = "capacity/index.json";
let loaded: Promise<void> | null = null;
let dirty = false;
let flushing: ReturnType<typeof setTimeout> | null = null;

const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

function load(): Promise<void> {
  if (!useBlob()) return Promise.resolve();
  loaded ??= (async () => {
    const r = await get(INDEX, { access: "private", useCache: false }).catch(() => null);
    if (!r?.stream) return;
    const j = JSON.parse(await new Response(r.stream).text()) as Record<string, Cap | null>;
    for (const [k, v] of Object.entries(j)) if (!memo.has(k)) memo.set(k, v);
  })().catch(() => {});
  return loaded;
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
    const r = await get(INDEX, { access: "private", useCache: false }).catch(() => null);
    const theirs = r?.stream ? (JSON.parse(await new Response(r.stream).text()) as Record<string, Cap | null>) : {};
    const all = { ...theirs, ...Object.fromEntries(memo) };
    await put(INDEX, JSON.stringify(all), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true }).catch((e) => console.error("[tavily] cache write failed", e));
  }, 4000);
}

export async function roomCapacity(venue: string, city: string): Promise<Cap | null> {
  const key = `${venue}|${city}`.toLowerCase();
  await load();
  if (memo.has(key)) return memo.get(key)!;
  if (!hasTavily()) return null;
  const r = await fetch(`${API}/search`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.TAVILY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query: `${venue} ${city} venue capacity`, search_depth: "basic", max_results: 5, include_answer: false }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) {
    console.error(`[tavily] HTTP ${r.status}`);
    return null;
  }
  const j = (await r.json()) as { results?: { url: string; title: string; content: string }[] };
  const pages = (j.results ?? []).map((x) => ({ url: x.url, text: `${x.title}\n${x.content}` }));
  const cap = pickCapacity(venue, pages);
  memo.set(key, cap);
  scheduleFlush();
  return cap;
}
