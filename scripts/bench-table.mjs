// Prints the README's benchmark table from finished tours on a live Routed, newest run per artist.
// Usage: node scripts/bench-table.mjs <baseUrl> <id>[,<id>...]
const [BASE = "https://routed-tours.vercel.app", ids = ""] = process.argv.slice(2);
const rows = [];
for (const id of ids.split(",").filter(Boolean)) {
  const t = await (await fetch(`${BASE}/api/tours/${id}`)).json();
  const p = t.plan;
  const g = p?.guess;
  if (!g?.stops?.length) {
    console.error(id, "has no comparison");
    continue;
  }
  const theirs = g.stops.filter((x) => !p.stops.some((s) => s.marketId === x.marketId));
  const worst = [...theirs].sort((a, b) => (b.rank ?? 1e9) - (a.rank ?? 1e9))[0];
  const missed = p.stops.filter((s) => !g.stops.some((x) => x.marketId === s.marketId)).sort((a, b) => a.score.rank - b.score.rank)[0];
  rows.push({
    id,
    artist: p.artist.name,
    routed: g.rankMean.routed,
    guess: g.rankMean.guess,
    shared: g.shared,
    shows: g.stops.length,
    missed: missed ? `${missed.city} (#${missed.score.rank})` : "–",
    worst: worst ? `${worst.city} (${worst.rank ? `#${worst.rank}` : "not a touring city"})` : "–",
  });
}
rows.sort((a, b) => b.guess - b.routed - (a.guess - a.routed));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`Routed ${mean(rows.map((r) => r.routed)).toFixed(1)} vs model alone ${mean(rows.map((r) => r.guess)).toFixed(1)} across ${rows.length} artists\n`);
console.log("| Artist | Routed | Model alone | Cities in common | Strongest city the model missed | Weakest city it chose |");
console.log("|---|---|---|---|---|---|");
for (const r of rows) console.log(`| [${r.artist}](${BASE}/tour/${r.id}) | #${r.routed.toFixed(1)} | #${r.guess.toFixed(1)} | ${r.shared} of ${r.shows} | ${r.missed} | ${r.worst} |`);
