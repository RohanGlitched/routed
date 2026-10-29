import { test } from "node:test";
import assert from "node:assert/strict";
import { FILL_MAX, fillDates, runLegs, type FillCity } from "../lib/geo/fill.ts";

const at = (marketId: string, city: string, lat: number, lon: number, label: string) => ({ marketId, city, lat, lon, label });
const NASHVILLE = at("nashville-us-tn", "Nashville", 36.1627, -86.7816, "Nashville, TN");
const CINCINNATI = at("cincinnati-us-oh", "Cincinnati", 39.1031, -84.512, "Cincinnati, OH");
const MEMPHIS = at("memphis-us-tn", "Memphis", 35.1495, -90.049, "Memphis, TN");
const DENVER = at("denver-us-co", "Denver", 39.7392, -104.9903, "Denver, CO");
const SLC = at("salt-lake-city-us-ut", "Salt Lake City", 40.7608, -111.891, "Salt Lake City, UT");
const PORTLAND = at("portland-us-or", "Portland", 45.5152, -122.6784, "Portland, OR");

const stops = [
  { ...NASHVILLE, date: "2027-05-06", travelDays: 0, dayOff: false, fromKm: 0, fromHours: 0 },
  { ...CINCINNATI, date: "2027-05-07", travelDays: 0, dayOff: false, fromKm: 510, fromHours: 6 },
  { ...MEMPHIS, date: "2027-05-09", travelDays: 1, dayOff: false, fromKm: 790, fromHours: 9.3 },
  { ...DENVER, date: "2027-05-12", travelDays: 2, dayOff: false, fromKm: 1694, fromHours: 19.9 },
  { ...SLC, date: "2027-05-14", travelDays: 1, dayOff: false, fromKm: 716, fromHours: 8.4 },
  { ...PORTLAND, date: "2027-05-16", travelDays: 1, dayOff: false, fromKm: 1226, fromHours: 14.4 },
];

const city = (marketId: string, name: string, lat: number, lon: number, rank: number): FillCity => ({ marketId, name, lat, lon, rank });
const fanMap: FillCity[] = [
  city("denver-us-co", "Denver", 39.7392, -104.9903, 4),
  city("boulder-us-co", "Boulder", 40.015, -105.2705, 9),
  city("chicago-us-il", "Chicago", 41.8781, -87.6298, 20),
  city("boise-us-id", "Boise", 43.615, -116.2023, 34),
  city("kansas-city-us-mo", "Kansas City", 39.0997, -94.5786, 36),
  city("tulsa-us-ok", "Tulsa", 36.154, -95.9928, 61),
  city("louisville-us-ky", "Louisville", 38.2527, -85.7585, 12),
];

test("fill dates sit on the long legs only, ranked by the fan map, and never touch a stop", () => {
  const legs = fillDates(stops, fanMap, "na");
  // Nashville to Cincinnati has no dark day; every other leg here has at least one.
  assert.deepEqual(legs.map((l) => `${l.from}>${l.to}`), ["Cincinnati>Memphis", "Memphis>Denver", "Denver>Salt Lake City", "Salt Lake City>Portland"]);
  const md = legs.find((l) => l.to === "Denver")!;
  assert.equal(md.index, 3);
  assert.deepEqual(md.dark, ["2027-05-10", "2027-05-11"]);
  // Tulsa is on the way. Kansas City is too, but more than a show day's 8 h from Memphis and more than 8 h short of
  // Denver, so no dark day lets the band play it and still make Denver on its date. Chicago is a long way round,
  // Boulder sits inside Denver's radius, and Denver is already on the tour.
  assert.deepEqual(md.options.map((o) => o.city), ["Tulsa"]);
  const tulsa = md.options[0]!;
  assert.equal(tulsa.fanRank, 61);
  assert.equal(tulsa.date, "2027-05-10");
  assert.ok(tulsa.addedKm >= 0 && tulsa.addedKm < 100, `Tulsa adds ${tulsa.addedKm} km`);
  assert.ok(tulsa.fromHours <= 8);
  // Boise is on the way from Salt Lake City to Portland.
  assert.deepEqual(legs.find((l) => l.to === "Portland")!.options.map((o) => o.city), ["Boise"]);
  // Louisville is inside Cincinnati's radius: never a fill date, though it ranks high.
  assert.ok(legs.every((l) => l.options.every((o) => o.city !== "Louisville")));
});

test("no more than FILL_MAX options a leg, and nothing past the fan map's cut-off", () => {
  const many = Array.from({ length: 8 }, (_, k) => city(`x${k}`, `Town ${k}`, 37.5 + k * 0.05, -97 - k * 0.6, 40 + k));
  const legs = fillDates(stops, many, "na");
  assert.ok(legs.every((l) => l.options.length <= FILL_MAX));
  assert.equal(fillDates(stops, [city("tulsa-us-ok", "Tulsa", 36.154, -95.9928, 101)], "na").find((l) => l.to === "Denver")!.options.length, 0);
});

test("a run with a two-travel-day jump reads as two legs, named by region where most of its cities are", () => {
  const r = runLegs(stops)!;
  assert.equal(r.legs.length, 2);
  assert.deepEqual(r.legs.map((l) => [l.region, l.first, l.last, l.stops]), [
    ["Southeast", "Nashville", "Memphis", 3],
    ["West", "Denver", "Portland", 3],
  ]);
  assert.deepEqual(r.jumps, [{ from: "Memphis", to: "Denver", km: 1694, hours: 19.9, travelDays: 2 }]);
  // No jump of two travel days: one run, no legs to name.
  assert.equal(runLegs(stops.map((s) => ({ ...s, travelDays: Math.min(1, s.travelDays) }))), null);
});
