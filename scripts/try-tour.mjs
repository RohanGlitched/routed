// Runs one tour on a live Routed and prints the comparison. Usage: node scripts/try-tour.mjs <base> "<artist>" "<from>" [draw]
const [base, artist, from, draw] = process.argv.slice(2);
const date = new Date(Date.now() + 150 * 86_400_000).toISOString().slice(0, 10);
const auth = process.env.ADMIN_TOKEN ? { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {};
const { id, error } = await (await fetch(`${base}/api/tours`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify({ artist, from, firstDate: date, shows: 8, draw: Number(draw) || undefined }) })).json();
if (!id) throw new Error(error);
const res = await fetch(`${base}/api/tours/${id}/run`, { method: "POST" });
for await (const _ of res.body);
const r = await (await fetch(`${base}/api/tours/${id}`)).json();
const p = r.plan, g = p?.guess;
console.log(`${artist} ${id} ${r.status} routed #${g?.rankMean.routed?.toFixed(1)} alone #${g?.rankMean.guess?.toFixed(1)} | ours: ${p?.stops.map((s) => `${s.city}#${s.score.rank}`).join(" ")} | alone: ${g?.stops.map((s) => `${s.city}#${s.rank ?? "-"}`).join(" ")} | genres ${p?.audience?.taste?.music?.slice(0, 4).map((x) => x.name).join("/")}`);
