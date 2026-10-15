// Measures the rooms a live Routed couldn't (Wikidata throttles shared serverless addresses) with the same reader,
// from this machine, and adds the answers to the live room index. Then re-size the tours.
// Usage: ADMIN_TOKEN=... node --conditions=react-server --import tsx scripts/measure-rooms.ts <baseUrl> <id>[,<id>...]
import { candidatesBySize, orchestraHallFor, roomNameOk } from "../lib/agent/rooms.ts";
import { roomCapacity } from "../lib/web.ts";
import type { TourRecord } from "../lib/types.ts";

const [BASE = "https://routed-tours.vercel.app", ids = ""] = process.argv.slice(2);
const entries: Record<string, { value: number; source: string; quote: string }> = {};
let asked = 0;
for (const id of ids.split(",").filter(Boolean)) {
  const t = (await (await fetch(`${BASE}/api/tours/${id}`)).json()) as TourRecord;
  const draw = t.input.draw;
  const genres = t.plan?.artist.genreKeys ?? t.plan?.artist.genres ?? [];
  for (const s of t.plan?.stops ?? []) {
    // The rooms the re-size pass would look at: the booked one, then the next five in measuring order.
    const pool = s.rooms.filter((r) => roomNameOk(r.name, draw) && !orchestraHallFor(r.name, genres));
    const booked = pool.find((r) => r.id === s.roomId);
    const next = draw ? candidatesBySize(pool.filter((r) => r !== booked), draw).slice(0, 5) : [];
    for (const r of [booked, ...next].filter((x): x is NonNullable<typeof x> => Boolean(x))) {
      if (r.capacity || entries[r.id]) continue;
      asked++;
      const cap = await roomCapacity(r, s.label).catch(() => null);
      if (cap) entries[r.id] = cap;
    }
  }
  console.log(id, t.plan?.artist.name, "measured so far", Object.keys(entries).length, "of", asked);
}
const r = await fetch(`${BASE}/api/admin/capacities`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ADMIN_TOKEN}` }, body: JSON.stringify({ entries }) });
console.log("posted", Object.keys(entries).length, "->", r.status, await r.text());
