import { test } from "node:test";
import assert from "node:assert/strict";
import { allHolds, csvField, GRID_COLUMNS, HOLD_SEPARATOR, holdAsk, routingCsv, routingRows } from "../lib/export.ts";
import type { Plan, Stop } from "../lib/types.ts";

const score = (rank: number) => ({ marketId: "", name: "", label: "", lat: 0, lon: 0, affinity: 1, tiles: 1, rank });
const stop = (over: Partial<Stop> & Pick<Stop, "marketId" | "city" | "label" | "lat" | "lon" | "date">): Stop => ({
  fromKm: 0,
  fromHours: 0,
  travelDays: 0,
  dayOff: false,
  score: score(1),
  rooms: [],
  openers: [],
  after: [],
  ...over,
});

const stops: Stop[] = [
  stop({
    marketId: "memphis-us-tn",
    city: "Memphis",
    label: "Memphis, TN",
    lat: 35.1495,
    lon: -90.049,
    date: "2027-05-09",
    rooms: [{ id: "r1", name: "Minglewood Hall, Memphis", tags: [], capacity: { value: 1200, source: "https://en.wikipedia.org/wiki/Minglewood_Hall", quote: "" } }],
    roomId: "r1",
    pitch: { subject: "Hold request: May 9, 2027", body: "Hi,\nCould we place a 1st hold? Fans rank ~~#9~~ the city first.\nThanks,", struck: ["#9"] },
  }),
  stop({
    marketId: "denver-us-co",
    city: "Denver",
    label: "Denver, CO",
    lat: 39.7392,
    lon: -104.9903,
    date: "2027-05-12",
    nights: 2,
    fromKm: 1694,
    fromHours: 19.9,
    travelDays: 2,
    rooms: [{ id: "r2", name: "Ogden Theatre", tags: [] }],
    roomId: "r2",
  }),
];

const plan = {
  artist: { name: "Test Artist" },
  region: "na",
  stops,
  cities: [
    { marketId: "memphis-us-tn", name: "Memphis", label: "Memphis, TN", lat: 35.1495, lon: -90.049, affinity: 1, tiles: 1, rank: 1 },
    { marketId: "denver-us-co", name: "Denver", label: "Denver, CO", lat: 39.7392, lon: -104.9903, affinity: 1, tiles: 1, rank: 4 },
    { marketId: "tulsa-us-ok", name: "Tulsa", label: "Tulsa, OK", lat: 36.154, lon: -95.9928, affinity: 0.8, tiles: 1, rank: 61 },
  ],
} as unknown as Plan;

test("the routing grid has one row a show, in the tour book's own fields", () => {
  const rows = routingRows(plan, 1500);
  assert.deepEqual(rows[0], [...GRID_COLUMNS]);
  assert.equal(rows.length, 3);
  const [first, second] = [rows[1]!, rows[2]!];
  assert.equal(first[0], "2027-05-09");
  assert.equal(first[1], "Memphis, TN");
  assert.equal(first[2], "Minglewood Hall, Memphis");
  assert.equal(first[3], "1200");
  assert.equal(first[4], "https://en.wikipedia.org/wiki/Minglewood_Hall");
  assert.equal(first[5], "80");
  assert.equal(first[6], "1st hold on the date (1 night), 2nd if taken");
  assert.match(first[7]!, /^no other show on this run within \d+ km of Memphis\.$/);
  assert.deepEqual(first.slice(8, 11), ["", "", ""]);
  // A two-night stand lists both nights; a room with no published size says to ask and has no fit.
  assert.equal(second[0], "2027-05-12 and 2027-05-13");
  assert.equal(second[4], "Not found on the web; ask the room");
  assert.equal(second[5], "");
  assert.equal(second[6], "1st hold on both dates (2 nights), 2nd if taken");
  assert.deepEqual(second.slice(8, 11), ["1694", "19.9", "2"]);
  // Tulsa sits on a dark day between the two shows, from the same fan map the day sheet reads.
  assert.match(second[11]!, /^Tulsa \(fan #61, (right on the way|adds [\d,]+ km), 5\/1[01]\)$/);
});

test("the CSV quotes what needs quoting and reads as UTF-8 in a spreadsheet", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField("Minglewood Hall, Memphis"), '"Minglewood Hall, Memphis"');
  assert.equal(csvField('the "Hall"'), '"the ""Hall"""');
  assert.equal(csvField("two\nlines"), '"two\nlines"');
  assert.equal(csvField(undefined), "");
  const csv = routingCsv(plan, 1500);
  assert.ok(csv.startsWith("﻿Date,City,Venue,"));
  assert.ok(csv.endsWith("\r\n"));
  assert.equal(csv.split("\r\n").length, 4);
  assert.ok(csv.includes('"Minglewood Hall, Memphis",1200,'));
});

test("without a usual crowd the grid leaves the fit blank", () => {
  assert.equal(routingRows(plan)[1]![5], "");
});

test("copy all holds gives every stop's subject and body, struck figures out, separated", () => {
  const text = allHolds(plan);
  const parts = text.split(HOLD_SEPARATOR);
  assert.equal(parts.length, 2);
  assert.equal(parts[0], "Stop 1 of 2: Memphis, TN, Sunday, May 9, 2027\nSubject: Hold request: May 9, 2027\n\nHi,\nCould we place a 1st hold? Fans rank the city first.\nThanks,");
  assert.equal(parts[1], "Stop 2 of 2: Denver, CO, Wednesday, May 12, 2027\n(No hold request drafted for this stop.)");
  assert.ok(!text.includes("~~"));
});

test("the hold ask names the nights", () => {
  assert.equal(holdAsk({}), "1st hold on the date (1 night), 2nd if taken");
  assert.equal(holdAsk({ nights: 2 }), "1st hold on both dates (2 nights), 2nd if taken");
});
