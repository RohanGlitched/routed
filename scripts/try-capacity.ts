// Checks the capacity reader against live Tavily results for well-known rooms. Usage: npx tsx scripts/try-capacity.ts
import { readFileSync } from "node:fs";
import { pickCapacity } from "../lib/agent/capacity.ts";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
for (const [v, c] of [["First Avenue", "Minneapolis"], ["Crystal Ballroom", "Portland"], ["Union Transfer", "Philadelphia"], ["Thalia Hall", "Chicago"], ["The Ogden Theatre", "Denver"], ["Neumos", "Seattle"]]) {
  const t = Date.now();
  const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { authorization: `Bearer ${env.TAVILY_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ query: `${v} ${c} venue capacity`, search_depth: "basic", max_results: 5 }) });
  const j = await r.json() as { results?: { url: string; title: string; content: string }[] };
  const cap = pickCapacity(v, (j.results ?? []).map((x) => ({ url: x.url, text: `${x.title}\n${x.content}` })));
  console.log(v, r.status, Date.now() - t, "ms", cap ? `${cap.value} ${new URL(cap.source).hostname} | ${cap.quote}` : "none");
}
