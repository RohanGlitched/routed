import { test } from "node:test";
import assert from "node:assert/strict";
import { posterMap } from "../lib/geo/map.ts";
import { HEAT_STEP, publicTour, snapHeat } from "../lib/publictour.ts";
import { rng } from "../lib/headtohead.ts";
import type { Plan, TourRecord } from "../lib/types.ts";

/** A heatmap like a run's: 700 tiles across North America, hotter around a few cities. */
function heat() {
  const r = rng(7);
  const hubs = [[36.16, -86.78], [35.6, -82.55], [45.52, -122.68], [39.74, -104.99], [30.27, -97.74]];
  return Array.from({ length: 700 }, (_, i) => {
    const [la, lo] = hubs[i % hubs.length]!;
    const near = r() < 0.6;
    return { lat: +(near ? la! + (r() - 0.5) * 2 : 25 + r() * 24).toFixed(3), lon: +(near ? lo! + (r() - 0.5) * 2 : -125 + r() * 55).toFixed(3), affinity: +r().toFixed(4), popularity: +r().toFixed(4) };
  });
}

test("the published heatmap is a grid of normalised cells, and the poster drawn from it matches the original", () => {
  const raw = heat();
  const snapped = snapHeat(raw);
  assert.ok(snapped.length < raw.length);
  assert.ok(snapped.every((c) => c.popularity === undefined && c.affinity >= 0 && c.affinity <= 1));
  assert.ok(snapped.every((c) => Math.abs(c.lat / HEAT_STEP - Math.round(c.lat / HEAT_STEP)) < 1e-6 && Math.abs(c.lon / HEAT_STEP - Math.round(c.lon / HEAT_STEP)) < 1e-6), "on the grid");
  assert.ok(!snapped.some((c) => raw.some((t) => t.affinity === c.affinity && t.lat === c.lat)), "no raw tile survives");
  const a = posterMap("na", raw, []).dots, b = posterMap("na", snapped, []).dots;
  assert.equal(a.length, b.length);
  const diff = a.reduce((n, d, i) => n + Math.abs(d[2] - b[i]![2]), 0) / a.length;
  assert.ok(diff < 0.12, `mean dot radius moved ${diff.toFixed(3)}`);
});

test("a published tour keeps what the pages print and drops Qloo's raw scores", () => {
  const score = { marketId: "nashville-us-tn", name: "Nashville", label: "Nashville, TN", lat: 36.16, lon: -86.78, affinity: 0.991, affinityRank: 0.99, popularity: 0.87, tiles: 12, rank: 2 };
  const plan = {
    heat: heat().slice(0, 50),
    cities: [score],
    stops: [{ marketId: score.marketId, city: "Nashville", label: "Nashville, TN", lat: 36.16, lon: -86.78, date: "2027-05-01", fromKm: 0, fromHours: 0, travelDays: 0, dayOff: false, score, rooms: [{ id: "r", name: "Ryman Auditorium", tags: [], affinity: 0.93, popularity: 0.99, rating: 4.8, capacity: { value: 2362, source: "https://x.org", quote: "" } }], roomId: "r", openers: [{ id: "o", name: "Opener", affinity: 0.8, popularity: 0.4, shared: [] }], openerId: "o", after: [{ id: "a", name: "Bar", affinity: 0.7 }] }],
    audience: { age: { "25_to_29": 0.3 }, gender: {}, tags: [{ id: "t", name: "Americana", affinity: 0.9 }], trend: [], brands: [] },
  } as unknown as Plan;
  const out = publicTour({ id: "abcdefghij", createdAt: "", status: "done", input: { artist: "x", from: "y", firstDate: "2027-05-01", shows: 1 }, log: [], plan } as TourRecord).plan!;
  assert.deepEqual(Object.keys(out.cities[0]!).sort(), ["label", "lat", "lon", "marketId", "name", "rank"]);
  const s = out.stops[0]!;
  assert.equal(s.score.rank, 2);
  assert.equal(s.rooms[0]!.affinity, 0.93, "the day sheet prints the room's fan affinity");
  assert.equal(s.rooms[0]!.capacity!.value, 2362);
  assert.equal(s.rooms[0]!.popularity, undefined);
  assert.equal(s.openers[0]!.popularity, undefined);
  assert.equal(s.after[0]!.affinity, undefined);
  assert.equal(out.audience.tags[0]!.name, "Americana");
  assert.equal(out.audience.tags[0]!.affinity, undefined);
  assert.equal(plan.cities[0]!.affinity, 0.991, "the stored plan is untouched");
});

test("the published tour carries no Qloo entity id, image link or full-precision score, and a stop's ids still match", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const path = ".data/tours/8v4ce57nx6.json";
  if (!existsSync(path)) return;
  const rec = JSON.parse(readFileSync(path, "utf8")) as TourRecord;
  const out = publicTour(rec);
  const json = JSON.stringify(out);
  assert.equal((json.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).length, 0, "no Qloo UUIDs");
  assert.ok(!/images\.qloo\.com/.test(json), "no image links");
  assert.ok(!/"(affinity|popularity|venueAffinity)":0\.\d{3,}/.test(json), "scores to two places");
  for (const s of out.plan!.stops) {
    assert.ok(s.rooms.some((r) => r.id === s.roomId), `${s.city}: the booked room's id matches a room`);
    assert.ok(!s.openerId || s.openers.some((o) => o.id === s.openerId));
    if (s.local) assert.ok(s.local.tiles.length <= rec.plan!.stops.find((x) => x.marketId === s.marketId)!.local!.tiles.length);
  }
  assert.equal(publicTour(rec).plan!.stops[0]!.roomId, out.plan!.stops[0]!.roomId, "stable across calls");
});
