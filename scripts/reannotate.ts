// Re-annotates stored tours under the Oct 30 rules (lib/agent/reannotate.ts), from copies of the stored records,
// with no Qloo call: hand-checked capacities, the room and support rules, route fixes from this artist's earlier
// scouting, OpenStreetMap neighbourhoods, reasons; then, where dates, rooms or the support act moved, the hold
// requests are re-drafted by the writer model from each stop's evidence (one call per tour).
//
// Usage (from routed/; keys are read from .env.local by the loader below, never printed):
//   node --conditions=react-server --import tsx scripts/reannotate.ts <in-dir> <out-dir> [--dry] [--no-model] [ids...]
// The records written to <out-dir> are uploaded to the store separately, after a read.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TourRecord, Usage } from "../lib/types.ts";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  const want = new Set(["NEBIUS_API_KEY", "NEBIUS_BASE_URL"]);
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m || !want.has(m[1]!) || process.env[m[1]!]) continue;
    process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const { reannotate } = await import("../lib/agent/reannotate.ts");
const { writePitches } = await import("../lib/agent/pitch.ts");
const { osmNeighbourhoodNear } = await import("../lib/osm.ts");
const { newUsage, withUsage } = await import("../lib/usage.ts");

/** The poster wall and the flagship, and what each may change in its route (lib/agent/reannotate.ts RouteMode). */
const WALL: Record<string, { route: "keep" | "rules" | "detour"; carveHome?: boolean }> = {
  "8v4ce57nx6": { route: "keep" }, // the flagship the video shows: same cities
  "5ezd3ab55f": { route: "detour" },
  fx3xht5bex: { route: "detour" },
  at2uxhew2q: { route: "detour" },
  "3nuqugrj3n": { route: "detour" },
  w4cverzz63: { route: "rules" },
  xf4rbjj9s9: { route: "rules", carveHome: true },
  xzm49sq9qt: { route: "detour" },
};
/** Donor runs must come from the booking-rules pass on (Oct 15), so their rooms were sized the current way. */
const DONOR_FROM = "2026-10-15";

const [inDir, outDir, ...rest] = process.argv.slice(2);
if (!inDir || !outDir) throw new Error("usage: reannotate.ts <in-dir> <out-dir> [--dry] [--no-model] [ids...]");
const dry = rest.includes("--dry");
const useModel = !rest.includes("--no-model");
const ids = rest.filter((x) => !x.startsWith("--"));
const todo = ids.length ? ids : Object.keys(WALL);
mkdirSync(outDir, { recursive: true });

const all = readdirSync(inDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(inDir, f), "utf8")) as TourRecord);
const usage: Usage = newUsage();
const at = new Date().toISOString();
const summary: unknown[] = [];

for (const id of todo) {
  const rec = all.find((r) => r.id === id);
  if (!rec?.plan) throw new Error(`no record ${id}`);
  const mode = WALL[id] ?? { route: "keep" as const };
  const donors = all
    .filter((r) => r.id !== id && r.status === "done" && r.plan?.stops?.length && r.createdAt >= DONOR_FROM && r.plan.artist.name === rec.plan!.artist.name && r.input.draw === rec.input.draw && r.plan.region === rec.plan!.region)
    .flatMap((r) => r.plan!.stops.map((stop) => ({ stop, tour: r.id, createdAt: r.createdAt })));
  // OpenStreetMap for the hottest tile of each stop Qloo's places named nothing for (donor stops included: one may come in).
  const osm = new Map<string, { name: string; km?: number }>();
  for (const s of [...rec.plan.stops, ...donors.map((d) => d.stop)]) {
    if (osm.has(s.marketId) || !s.local?.hot || s.local.hot.name) continue;
    const found = await osmNeighbourhoodNear(s.local.hot.lat, s.local.hot.lon, s.city);
    if (found) osm.set(s.marketId, found);
  }
  const r = reannotate(rec, { route: mode.route, donors, osm, at, carveHome: mode.carveHome });
  let next = r.rec;
  let drafted = 0;
  if (r.stale && useModel && !dry) {
    const plan = next.plan!;
    const t = Date.now();
    const pitched = await withUsage(usage, () => writePitches(plan, true, rec.input.draw));
    plan.stops.forEach((s, i) => (s.pitch = pitched.pitches[i]));
    drafted = pitched.pitches.length;
    const struck = pitched.pitches.reduce((n, p) => n + p.struck.length, 0);
    next = { ...next, log: [...next.log, { at, kind: pitched.model ? "model" : "rule", text: `Re-drafted the ${drafted} hold requests for the talent buyer from each stop's evidence as it now stands (dates, rooms and the support act as re-checked), with the offer fields to fill in.`, result: struck ? `${struck} figure${struck === 1 ? "" : "s"} not in the evidence ${struck === 1 ? "was" : "were"} struck` : "Every figure checked against the evidence", ms: Date.now() - t }] };
  }
  if (!dry) writeFileSync(join(outDir, `${id}.json`), JSON.stringify(next));
  summary.push({ id, artist: rec.plan.artist.name, changes: r.changes, drafted, stops: next.plan!.stops.map((s) => `${s.date} ${s.city} ${s.fromKm}km td${s.travelDays}`) });
  console.log(JSON.stringify(summary.at(-1), null, 1));
}
const cost = usage.tokensIn * 1e-6 + usage.tokensOut * 3e-6;
console.log(`model calls ${usage.modelCalls}, tokens in ${usage.tokensIn}, out ${usage.tokensOut}, about $${cost.toFixed(3)} at the Token Factory list price`);
writeFileSync(join(outDir, "_summary.json"), JSON.stringify({ at, usage, summary }, null, 1));
