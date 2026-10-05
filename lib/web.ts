import "server-only";
import { pickCapacity } from "./agent/capacity";

/**
 * Tavily, for the one fact Qloo doesn't carry: how many people a room holds. Search returns page snippets; the
 * capacity is read out of them by rule (agent/capacity.ts) with its quote and source kept.
 */
const API = "https://api.tavily.com";

export const hasTavily = () => Boolean(process.env.TAVILY_API_KEY);

const memo = new Map<string, { value: number; source: string; quote: string } | null>();

export async function roomCapacity(venue: string, city: string): Promise<{ value: number; source: string; quote: string } | null> {
  const key = `${venue}|${city}`.toLowerCase();
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
  return cap;
}
