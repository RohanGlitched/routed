// Runs the with/without-Qloo benchmark: one tour per artist below, on a live Routed, each shelved on /proof.
// Usage: ADMIN_TOKEN=… node scripts/bench.mjs [baseUrl] [first-n]
// The artists span sizes, genres and regions on purpose; the list is fixed so the benchmark can be re-run.
const BASE = process.argv[2] ?? "http://localhost:3800";
const LIMIT = Number(process.argv[3] ?? 99);
export const ARTISTS = [
  { artist: "Japanese Breakfast", from: "Portland, OR", draw: 1500 },
  { artist: "MJ Lenderman", from: "Asheville, NC", draw: 900 },
  { artist: "Zach Bryan", from: "Tulsa, OK", draw: 15000 },
  { artist: "Khruangbin", from: "Houston, TX", draw: 3000 },
  { artist: "Turnstile", from: "Baltimore, MD", draw: 2500 },
  { artist: "Waxahatchee", from: "Birmingham, AL", draw: 1500 },
  { artist: "Alvvays", from: "Toronto, ON", draw: 1500 },
  { artist: "Tyler Childers", from: "Lexington, KY", draw: 5000 },
  { artist: "Caamp", from: "Columbus, OH", draw: 2500 },
  { artist: "Clairo", from: "Boston, MA", draw: 3000 },
  { artist: "Fontaines D.C.", from: "Dublin, Ireland", draw: 3000 },
  { artist: "Arlo Parks", from: "London, UK", draw: 1500 },
  { artist: "Wet Leg", from: "Southampton, UK", draw: 2000 },
  { artist: "Parcels", from: "Berlin, Germany", draw: 2000 },
];
const date = new Date(Date.now() + 150 * 86_400_000).toISOString().slice(0, 10);

for (const a of ARTISTS.slice(0, LIMIT)) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/tours`, { method: "POST", headers: { "content-type": "application/json", ...(process.env.ADMIN_TOKEN ? { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {}) }, body: JSON.stringify({ ...a, firstDate: date, shows: 8 }) });
  const { id, error } = await r.json();
  if (!id) {
    console.log(a.artist, "not queued:", error);
    continue;
  }
  const run = await fetch(`${BASE}/api/tours/${id}/run`, { method: "POST" });
  let done = null, fail = null, last = "";
  for await (const chunk of run.body) {
    last += Buffer.from(chunk).toString();
    let i;
    while ((i = last.indexOf("\n")) >= 0) {
      const line = last.slice(0, i);
      last = last.slice(i + 1);
      try {
        const e = JSON.parse(line);
        if (e.t === "done") done = e;
        if (e.t === "error") fail = e.message;
      } catch {}
    }
  }
  const rec = await (await fetch(`${BASE}/api/tours/${id}`)).json().catch(() => null);
  const g = rec?.plan?.guess;
  console.log(`${a.artist.padEnd(20)} ${id} ${done ? done.engine.planned : "FAILED " + fail} ${Math.round((Date.now() - t0) / 1000)}s  rank routed ${g?.rankMean?.routed?.toFixed(1)} guess ${g?.rankMean?.guess?.toFixed(1)} shared ${g?.shared}`);
  if (done && g && process.env.ADMIN_TOKEN) {
    await fetch(`${BASE}/api/admin/shelve`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ADMIN_TOKEN}` }, body: JSON.stringify({ id, shelf: "bench" }) });
  }
}
