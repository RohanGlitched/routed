import { test } from "node:test";
import assert from "node:assert/strict";
import { HOT_KM, hotSpot, kmBetween, localMap, localTiles, placeHeat } from "../lib/geo/local.ts";
import { tourCalendar } from "../lib/ics.ts";
import type { Plan } from "../lib/types.ts";

const raw = [
  { lat: 45.518, lon: -122.678, affinity: 1, popularity: 1 }, // downtown Portland: the hottest
  { lat: 45.551, lon: -122.675, affinity: 1, popularity: 0.6 },
  { lat: 45.52, lon: -122.654, affinity: 0.99, popularity: 0.99 },
  { lat: 45.588, lon: -122.596, affinity: 0.5, popularity: 0.2 },
  { lat: 45.45, lon: -122.75, affinity: 0.1, popularity: 0.05 },
];

test("local tiles are strength-stretched, strongest first, and capped", () => {
  const tiles = localTiles(raw, 3);
  assert.equal(tiles.length, 3);
  assert.equal(tiles[0]![2], 1);
  assert.ok(tiles[1]![2] <= tiles[0]![2] && tiles[2]![2] <= tiles[1]![2]);
  // affinity × popularity, not affinity alone: the 1 × 0.6 tile ranks below the 0.99 × 0.99 one
  assert.deepEqual([tiles[1]![0], tiles[1]![1]], [45.52, -122.654]);
  const all = localTiles(raw);
  assert.equal(all.at(-1)![2], 0);
});

test("the hottest tile and a room's place against it", () => {
  const tiles = localTiles(raw);
  assert.deepEqual(hotSpot(tiles), { lat: 45.518, lon: -122.678 });
  assert.equal(hotSpot([]), null);
  // Show Bar, 2 km east of the hot tile but on a top-tenth tile of its own: in the fans' area
  const near = placeHeat(tiles, { lat: 45.519, lon: -122.652 });
  assert.ok(near && near.inHot && near.strength >= 0.9, JSON.stringify(near));
  // A room 6 km north: not in it, with the distance said
  const far = placeHeat(tiles, { lat: 45.572, lon: -122.678 });
  assert.ok(far && !far.inHot && far.km > HOT_KM && far.km < 7, JSON.stringify(far));
  assert.equal(placeHeat([], { lat: 0, lon: 0 }), null);
});

test("the city map fits its square and keeps the room on it", () => {
  const tiles = localTiles(raw);
  const { dots, marks, scaleKm } = localMap(tiles, [{ lat: 45.519, lon: -122.652 }], 180);
  assert.equal(dots.length, tiles.length);
  for (const d of dots) assert.ok(d.x >= 0 && d.x <= 180 && d.y >= 0 && d.y <= 180 && d.r >= 1.4 && d.r <= 5.6, JSON.stringify(d));
  assert.equal(marks.length, 1);
  assert.ok(marks[0]!.x > 90, "the room is east of the centre");
  // the square spans the tiles' bounding box plus a margin: ~15 km of latitude here
  assert.ok(scaleKm > 15 && scaleKm < 20, String(scaleKm));
  assert.deepEqual(localMap([], [], 180), { dots: [], marks: [], scaleKm: 0 });
});

test("distance is symmetric and about right", () => {
  const a = { lat: 45.518, lon: -122.678 }, b = { lat: 45.551, lon: -122.675 };
  assert.ok(Math.abs(kmBetween(a, b) - 3.68) < 0.1);
  assert.equal(kmBetween(a, b), kmBetween(b, a));
});

test("the calendar file carries every show, the travel days and the day off, folded to 75 octets", () => {
  const stop = (city: string, date: string, travelDays = 0, dayOff = false) => ({
    marketId: city.toLowerCase(),
    city,
    label: `${city}, XX`,
    lat: 0,
    lon: 0,
    date,
    fromKm: 400,
    fromHours: 4.7,
    travelDays,
    dayOff,
    score: { marketId: city.toLowerCase(), name: city, label: city, lat: 0, lon: 0, affinity: 0.9, tiles: 3, rank: 2 },
    rooms: [{ id: "r1", name: "The Crystal Ballroom, a room with a very long name; and punctuation, too", address: "1332 W Burnside St", tags: [], capacity: { value: 1500, source: "https://example.com", quote: "" } }],
    roomId: "r1",
    openers: [{ id: "o1", name: "Opener", shared: [] }],
    openerId: "o1",
    after: [],
  });
  const plan = {
    artist: { id: "a", name: "Sierra Ferrell", genres: [] },
    region: "na",
    from: { marketId: "nashville", label: "Nashville, TN", lat: 0, lon: 0 },
    firstDate: "2027-03-12",
    lastDate: "2027-03-16",
    heat: [],
    cities: [],
    stops: [stop("Asheville", "2027-03-12"), stop("Portland", "2027-03-15", 2), stop("Seattle", "2027-03-17", 1, true)],
    totalKm: 1200,
    audience: { age: {}, gender: {}, tags: [], trend: [], brands: [] },
  } as unknown as Plan;
  const folded = tourCalendar(plan, "abcdefghij", "https://routed-tours.vercel.app");
  const lines = folded.split("\r\n");
  const ics = folded.replace(/\r\n /g, "");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.at(-2), "END:VCALENDAR");
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3 + 2 + 1, "three shows, two travel days, one day off");
  assert.ok(ics.includes("SUMMARY:Sierra Ferrell: Asheville at The Crystal Ballroom\\, a room with a very long"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20270312") && ics.includes("DTEND;VALUE=DATE:20270313"));
  assert.ok(ics.includes("SUMMARY:Day off (Sierra Ferrell tour)") && ics.includes("DTSTART;VALUE=DATE:20270316"));
  assert.ok(ics.includes("SUMMARY:Travel day: Asheville to Portland"));
  for (const l of lines) assert.ok(Buffer.byteLength(l, "utf8") <= 75, `line too long: ${l}`);
});
