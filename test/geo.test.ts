import { test } from "node:test";
import assert from "node:assert/strict";
import { findMarket, marketId, marketLabel, nearestMarket, MARKETS } from "../lib/geo/markets.ts";
import { orderStops, pathKm, pickCities, roadKm, schedule } from "../lib/geo/route.ts";

const m = (s: string) => {
  const r = findMarket(s);
  assert.ok(r, `no market for ${s}`);
  return r;
};

test("finds markets the way people type them", () => {
  assert.equal(marketLabel(m("Portland, OR")), "Portland, OR");
  assert.equal(marketLabel(m("portland maine")), "Portland, ME");
  assert.equal(marketLabel(m("Portland")), "Portland, OR"); // biggest wins
  assert.equal(marketLabel(m("Montreal")), "Montréal, QC");
  assert.equal(marketLabel(m("Brooklyn")), "New York, NY");
  assert.equal(marketLabel(m("NYC")), "New York, NY");
  assert.equal(marketLabel(m("Manchester, UK")), "Manchester, UK");
  assert.equal(marketLabel(m("Manchester, NH")), "Manchester, NH");
  assert.equal(marketLabel(m("Washington DC")), "Washington, DC");
  assert.equal(findMarket("Atlantis"), null);
});

test("market ids are stable and unique", () => {
  const ids = MARKETS.map(marketId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(marketId(m("Portland, OR")), "portland-us-or");
});

test("a heatmap tile belongs to the city it sits in, not a satellite", () => {
  // Midtown Manhattan and a Jersey City point both play as New York.
  assert.equal(nearestMarket({ lat: 40.754, lon: -73.984 })?.name, "New York");
  assert.equal(nearestMarket({ lat: 40.72, lon: -74.05 })?.name, "New York");
  // Open ocean has no market.
  assert.equal(nearestMarket({ lat: 35, lon: -60 }), null);
});

test("picking cities respects the radius clause", () => {
  const ranked = ["New York", "Philadelphia", "Boston", "Washington DC", "Baltimore", "Chicago"].map((s) => ({ market: m(s) }));
  const picked = pickCities(ranked, 4).map((p) => p.market.name);
  // Philadelphia is ~130 km from New York and Baltimore ~55 km from Washington: both skipped.
  assert.deepEqual(picked, ["New York", "Boston", "Washington", "Chicago"]);
});

test("ordering finds a sensible route and never a longer one than nearest-neighbour", () => {
  const from = m("Philadelphia");
  const stops = ["Seattle", "Boston", "Chicago", "Denver", "New York", "Minneapolis", "Portland, OR", "Washington DC"].map(m);
  const route = orderStops(from, stops);
  assert.equal(route.length, stops.length);
  assert.deepEqual(new Set(route), new Set(stops));
  // West coast at the far end, not in the middle.
  const names = route.map((s) => s.name);
  assert.ok(["Seattle", "Portland"].includes(names.at(-1)!), names.join(" > "));
  const scrambled = pathKm(from, stops);
  assert.ok(pathKm(from, route) < scrambled);
});

test("the calendar adds travel days for long drives and a day off after five shows", () => {
  const from = m("Philadelphia");
  const route = ["New York", "Boston", "Providence", "Hartford", "Albany", "Buffalo", "Chicago", "Denver"].map(m);
  const legs = schedule(from, route, "2027-03-12");
  assert.equal(legs[0]!.date, "2027-03-12");
  assert.equal(legs[1]!.date, "2027-03-13");
  // Five shows in a row (NY..Albany), then a day off before Buffalo.
  assert.equal(legs[5]!.dayOff, true);
  assert.equal(legs[5]!.date, "2027-03-18");
  // Buffalo to Chicago is ~1 000 km of road (~12 h): one travel day.
  assert.ok(legs[6]!.fromHours > 8);
  assert.equal(legs[6]!.travelDays, 1);
  // Chicago to Denver is ~1 950 km (~23 h): two travel days.
  assert.equal(legs[7]!.travelDays, 2);
  assert.equal(roadKm(m("Chicago"), m("Denver")), legs[7]!.fromKm);
});
