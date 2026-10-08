import { test } from "node:test";
import assert from "node:assert/strict";
import { capacitiesIn, pickCapacity } from "../lib/agent/capacity.ts";
import { checkNumbers, fit, longDate } from "../lib/agent/evidence.ts";
import { scoreCities } from "../lib/agent/cities.ts";
import { doorAdvice, topAge } from "../lib/agent/audience.ts";

test("capacity is read only when tied to the word", () => {
  assert.deepEqual(capacitiesIn("The Crystal Ballroom has a capacity of 1,500 and opened in 1914.").map((h) => h.value), [1500]);
  assert.deepEqual(capacitiesIn("a 1,100-capacity room on Hennepin").map((h) => h.value), [1100]);
  assert.deepEqual(capacitiesIn("The club holds about 650 people standing.").map((h) => h.value), [650]);
  assert.deepEqual(capacitiesIn("Capacity: 300").map((h) => h.value), [300]);
  // Years, addresses and prices aren't capacities.
  assert.deepEqual(capacitiesIn("Opened in 1914 at 1332 W Burnside. Tickets $25."), []);
  // A side stage or a minimum isn't the room.
  assert.deepEqual(capacitiesIn("The 7th St Entry is a smaller stage (capacity 250) attached to First Avenue").map((h) => h.value), []);
  assert.deepEqual(capacitiesIn("Min Capacity: 200 Max Capacity: 1200").map((h) => h.value), [1200]);
  // A stadium holds a stadium-sized crowd; "100,000" is a hundred thousand, not a hundred.
  assert.deepEqual(capacitiesIn("stadium capacity of 68,000").map((h) => h.value), [68000]);
  assert.deepEqual(capacitiesIn("capacity of 100,000").map((h) => h.value), [100000]);
  // European thousands and words.
  assert.deepEqual(capacitiesIn("Die Halle hat eine Kapazität von 1.200 Personen.").map((h) => h.value), [1200]);
  assert.deepEqual(capacitiesIn("Capacité : 1 500 places").map((h) => h.value), [1500]);
  // The look-back stops at the sentence, so a side room doesn't kill the main one.
  assert.deepEqual(capacitiesIn("Upstairs capacity: 200. Main room capacity: 900.").map((h) => h.value), [900]);
});

test("a venue whose name has no distinctive word must appear whole on the page", () => {
  const pages = [{ url: "https://example.com/f", text: "The Fillmore has a capacity of 1,150." }];
  assert.equal(pickCapacity("9:30 Club", pages), null);
  assert.equal(pickCapacity("9:30 Club", [{ url: "https://example.com/930", text: "9:30 Club capacity: 1,200" }])?.value, 1200);
});

test("a page must name the venue for its capacity to count, and agreement wins", () => {
  const pages = [
    { url: "https://en.wikipedia.org/wiki/First_Avenue", text: "First Avenue is a nightclub in Minneapolis with a capacity of 1,550." },
    { url: "https://example.com/a", text: "First Avenue main room: capacity 1,550 standing." },
    { url: "https://example.com/b", text: "The Fine Line has a capacity of 650." },
  ];
  assert.deepEqual(pickCapacity("First Avenue", pages)?.value, 1550);
  assert.equal(pickCapacity("Turf Club", pages), null);
});

test("figures not in the evidence are struck, visibly", () => {
  const evidence = ["City: Chicago. Of the 31 cities, Chicago ranks 2 for fan affinity.", "Date asked for: Friday, March 12 (2027-03-12)", "Capacity: 1,100"];
  const ok = checkNumbers("Chicago ranks 2nd of 31 cities. Could we hold March 12, 2027 for your 1,100-cap room?", evidence);
  assert.deepEqual(ok.struck, []);
  const bad = checkNumbers("They sold 2,000 tickets last time and have 45000 monthly listeners.", evidence);
  assert.deepEqual(bad.struck, ["2,000", "45000"]);
  assert.match(bad.text, /~~2,000~~ tickets/);
});

test("dates read the way a booker writes them", () => {
  assert.equal(longDate("2027-03-12"), "Friday, March 12");
});

test("heatmap tiles become ranked cities; a city scores its strongest tile (affinity × popularity)", () => {
  const tiles = [
    { lat: 41.88, lon: -87.63, affinity: 0.71, popularity: 0.9 }, // Chicago
    { lat: 41.95, lon: -87.65, affinity: 0.93, popularity: 0.8 }, // Chicago (Lakeview): 0.744
    { lat: 45.52, lon: -122.68, affinity: 0.88, popularity: 0.7 }, // Portland: 0.616
    { lat: 33.72, lon: -116.22, affinity: 0.99, popularity: 0.3 }, // Indio: hot but thin, 0.297
    { lat: 35.0, lon: -60.0, affinity: 0.99 }, // Atlantic: no city
  ];
  const cities = scoreCities(tiles, "na");
  assert.deepEqual(cities.map((c) => [c.name, c.affinity, c.tiles, c.rank]), [
    ["Chicago", 0.93, 2, 1],
    ["Portland", 0.88, 1, 2],
    ["Indio", 0.99, 1, 3],
  ]);
  assert.equal(cities[0]!.marketId, "chicago-us-il");
});

test("a room fits a crowd between 60% and 250% of the draw", () => {
  const r = (value?: number) => ({ id: "x", name: "x", tags: [], ...(value ? { capacity: { value, source: "s", quote: "q" } } : {}) });
  assert.equal(fit(r(1000), 1500), "fits");
  assert.equal(fit(r(800), 1500), "too small");
  assert.equal(fit(r(4000), 1500), "too big");
  assert.equal(fit(r(), 1500), "unknown");
  assert.equal(fit(r(1000)), "unknown");
});

test("door advice follows the age skew", () => {
  assert.match(doorAdvice({ "24_and_younger": 0.3, "55_and_older": -0.2 })!, /all-ages or 18\+/);
  assert.match(doorAdvice({ "24_and_younger": -0.2, "35_to_44": 0.1, "45_to_54": 0.12 })!, /21\+/);
  assert.equal(doorAdvice({}), undefined);
  assert.deepEqual(topAge({ "25_to_29": 0.4, "30_to_34": 0.2 }), { bucket: "25_to_29", value: 0.4 });
});
