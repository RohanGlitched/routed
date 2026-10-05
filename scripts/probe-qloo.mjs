// Day-one probe of every Qloo call Routed depends on (Playbook K1/L4: measure the API before designing around it).
// Saves each raw response to .probe/<name>.json and prints status, timing and a one-line summary.
// Usage: node scripts/probe-qloo.mjs ["Artist name"]   (reads QLOO_API_KEY from .env.local)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

for (const line of (() => { try { return readFileSync(".env.local", "utf8").split(/\r?\n/); } catch { return []; } })()) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const KEY = process.env.QLOO_API_KEY;
if (!KEY) throw new Error("Set QLOO_API_KEY in .env.local");
const HOSTS = [process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com", "https://api.qloo.com"];
const artist = process.argv[2] || "Japanese Breakfast";
mkdirSync(".probe", { recursive: true });

let host = HOSTS[0];
async function get(name, path, query) {
  const url = `${host}${path}?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`;
  const t = Date.now();
  const r = await fetch(url, { headers: { "X-Api-Key": KEY } });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  writeFileSync(`.probe/${name}.json`, JSON.stringify({ url: url.replace(host, ""), status: r.status, ms: Date.now() - t, body }, null, 2));
  const res = body?.results;
  const n = Array.isArray(res) ? res.length : res ? Object.entries(res).map(([k, v]) => `${k}:${Array.isArray(v) ? v.length : typeof v}`).join(" ") : "";
  console.log(`${String(r.status).padEnd(4)} ${String(Date.now() - t).padStart(5)}ms  ${name.padEnd(28)} ${n} ${r.ok ? "" : String(text).slice(0, 160)}`);
  return body;
}

// 0. Which host takes the key?
for (const h of HOSTS) {
  host = h;
  const b = await get(`host-${new URL(h).hostname}`, "/search", { query: artist, types: "urn:entity:artist", take: 3 });
  if (b?.results?.length) break;
}
console.log(`host: ${host}\n`);

const s = await get("search-artist", "/search", { query: artist, types: "urn:entity:artist", take: 5 });
const a = s?.results?.[0];
if (!a) throw new Error("artist not found");
const id = a.entity_id ?? a.id;
console.log(`artist: ${a.name} ${id} pop=${a.popularity}\n`);

// 1. Heatmaps: which "within" works at country scale, and how coarse are the tiles?
for (const [name, q] of [
  ["heat-us-query", { "filter.location.query": "United States" }],
  ["heat-usa-query", { "filter.location.query": "USA" }],
  ["heat-na-wkt", { "filter.location": "POLYGON((-125 24, -66 24, -66 50, -125 50, -125 24))" }],
  ["heat-us-city-boundary", { "filter.location.query": "United States", "output.heatmap.boundary": "city" }],
  ["heat-us-urncity-boundary", { "filter.location.query": "United States", "output.heatmap.boundary": "urn:city" }],
  ["heat-uk-query", { "filter.location.query": "United Kingdom" }],
  ["heat-europe-query", { "filter.location.query": "Europe" }],
  ["heat-chicago", { "filter.location.query": "Chicago" }],
]) await get(name, "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": id, take: 50, ...q });

// 2. Locality-level affinity: can we score cities directly?
await get("locality-insights", "/v2/insights", { "filter.type": "urn:entity:locality", "signal.interests.entities": id, take: 20 });
await get("destination-insights", "/v2/insights", { "filter.type": "urn:entity:destination", "signal.interests.entities": id, take: 20, "filter.geocode.country_code": "US" });

// 3. Venues: what tag marks a music venue?
for (const q of ["music venue", "concert hall", "live music", "nightclub"]) await get(`tags-${q.replace(/ /g, "-")}`, "/v2/tags", { "filter.query": q, "feature.semantic_search": true, take: 10 });
await get("tags-types-place", "/v2/tags/types", { "filter.parents.types": "urn:entity:place", take: 50 });
await get("places-chicago-signal", "/v2/insights", { "filter.type": "urn:entity:place", "signal.interests.entities": id, "filter.location.query": "Chicago", take: 20 });
await get("places-chicago-musicvenue", "/v2/insights", { "filter.type": "urn:entity:place", "signal.interests.entities": id, "filter.location.query": "Chicago", "filter.tags": "urn:tag:genre:place:music_venue", take: 20 });

// 4. Openers: similar artists, local to a city.
await get("artists-similar", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": id, take: 20 });
await get("artists-similar-chicago", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": id, "signal.location.query": "Chicago", take: 20 });
await get("artists-similar-lesspopular", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": id, "filter.popularity.max": 0.8, take: 20 });

// 5. Audience: demographics, taste tags, trend, cross-domain.
await get("demographics", "/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": id });
await get("taste-tags", "/v2/insights", { "filter.type": "urn:tag", "signal.interests.entities": id, take: 20 });
const end = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - 180 * 86400e3).toISOString().slice(0, 10);
await get("trending", "/v2/trending", { "filter.type": "urn:entity:artist", "signal.interests.entities": id, "filter.start_date": start, "filter.end_date": end, take: 50 });
await get("brands-fans", "/v2/insights", { "filter.type": "urn:entity:brand", "signal.interests.entities": id, take: 10 });
await get("explain", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": id, "feature.explainability": true, take: 5 });

// 6. Compare: headliner vs the top similar artist.
const sim = (await get("artists-for-compare", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": id, take: 3 }))?.results?.entities?.[0];
if (sim) await get("compare", "/v2/analysis/compare", { "a.signal.interests.entities": id, "b.signal.interests.entities": sim.entity_id, take: 20 });
console.log("\nRaw responses are in .probe/");
