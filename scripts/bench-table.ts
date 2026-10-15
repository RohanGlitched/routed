// Prints the README's benchmark tables from finished tours on a live Routed: the fan-map ranks, and the outside
// check against each artist's real recent tour (data/real-tours.json).
// Usage: npx tsx scripts/bench-table.ts <baseUrl> <id>[,<id>...]
import { unrankedLabel } from "../lib/geo/markets.ts";
import { outsideRow, realTourFor } from "../lib/outside.ts";
import type { TourRecord } from "../lib/types.ts";

const [BASE = "https://routed-tours.vercel.app", ids = ""] = process.argv.slice(2);
const rows: { id: string; artist: string; routed: number; guess: number; shared: number; shows: number; missed: string; worst: string; outside?: ReturnType<typeof outsideRow> }[] = [];
for (const id of ids.split(",").filter(Boolean)) {
  const t = (await (await fetch(`${BASE}/api/tours/${id}`)).json()) as TourRecord;
  const p = t.plan;
  const g = p?.guess;
  if (!p || !g?.stops?.length) {
    console.error(id, "has no comparison");
    continue;
  }
  const theirs = g.stops.filter((x) => !p.stops.some((s) => s.marketId === x.marketId));
  const worst = [...theirs].sort((a, b) => (b.rank ?? 1e9) - (a.rank ?? 1e9))[0];
  const missed = p.stops.filter((s) => !g.stops.some((x) => x.marketId === s.marketId)).sort((a, b) => a.score.rank - b.score.rank)[0];
  const real = realTourFor(p.artist.name);
  rows.push({
    id,
    artist: p.artist.name,
    routed: g.rankMean.routed ?? 0,
    guess: g.rankMean.guess ?? 0,
    shared: g.shared,
    shows: g.stops.length,
    missed: missed ? `${missed.city} (#${missed.score.rank})` : "–",
    worst: worst ? `${worst.city} (${worst.rank ? `#${worst.rank}` : unrankedLabel(worst, p.region)})` : "–",
    outside: real && real.region === p.region ? outsideRow(real, p.stops, g.stops) : undefined,
  });
}
rows.sort((a, b) => b.guess - b.routed - (a.guess - a.routed));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`Routed ${mean(rows.map((r) => r.routed)).toFixed(1)} vs model alone ${mean(rows.map((r) => r.guess)).toFixed(1)} across ${rows.length} artists\n`);
console.log("| Artist | Routed | Model alone | Cities in common | Strongest city the model missed | Weakest city it chose |");
console.log("|---|---|---|---|---|---|");
for (const r of rows) console.log(`| [${r.artist}](${BASE}/tour/${r.id}) | #${r.routed.toFixed(1)} | #${r.guess.toFixed(1)} | ${r.shared} of ${r.shows} | ${r.missed} | ${r.worst} |`);

const o = rows.filter((r) => r.outside).sort((a, b) => a.artist.localeCompare(b.artist));
const sum = (k: "routed" | "guess") => o.reduce((acc, r) => ({ hits: acc.hits + r.outside![k].hits, of: acc.of + r.outside![k].of }), { hits: 0, of: 0 });
const R = sum("routed"), G = sum("guess");
console.log(`\nOutside check, ${o.length} artists: Routed ${R.hits} of ${R.of} (${Math.round((100 * R.hits) / R.of)}%), model alone ${G.hits} of ${G.of} (${Math.round((100 * G.hits) / G.of)}%)\n`);
console.log("| Artist | Real tour | Routed's cities played | Model alone's cities played |");
console.log("|---|---|---|---|");
for (const r of o) console.log(`| ${r.artist} | ${r.outside!.tour}${r.outside!.year ? `, ${r.outside!.year}` : ""} (${r.outside!.played} cities) | ${r.outside!.routed.hits} of ${r.outside!.routed.of} | ${r.outside!.guess.hits} of ${r.outside!.guess.of} |`);
