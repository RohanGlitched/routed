import { test } from "node:test";
import assert from "node:assert/strict";
import { beyondBiggest, blendRanking, completeRanking, meanCI, populationRanking, precision, rPrecision, signTest } from "../lib/headtohead.ts";
import { infoboxArtist, marketsByRegion, showRows } from "../lib/wikitours.ts";
import { marketById } from "../lib/geo/markets.ts";

/* ───────────── the rankings and the metric ───────────── */

test("population ranks every market in the region, biggest first", () => {
  const p = populationRanking("na");
  assert.ok(p.length > 300);
  assert.equal(p[0], "new-york-city-us-ny");
  for (let i = 1; i < 50; i++) assert.ok(marketById(p[i - 1]!)!.pop >= marketById(p[i]!)!.pop);
  assert.ok(populationRanking("uk").includes("london-gb"));
  assert.ok(!populationRanking("eu").includes("london-gb"), "London is not mainland Europe");
});

test("a partial ranking is completed by population, without duplicates or other regions' cities", () => {
  const r = completeRanking(["asheville-us-nc", "asheville-us-nc", "london-gb", null, "nashville-us-tn"], "na");
  assert.deepEqual(r.slice(0, 3), ["asheville-us-nc", "nashville-us-tn", "new-york-city-us-ny"]);
  assert.equal(r.length, populationRanking("na").length);
  assert.equal(new Set(r).size, r.length);
});

test("Qloo + population averages the two places, with no weight to tune", () => {
  // Asheville first on Qloo but far down by population lands between the two; New York, first by population and
  // nowhere on this Qloo list, sinks only as far as the average sends it.
  const q = ["asheville-us-nc", "nashville-us-tn", "knoxville-us-tn"];
  const b = blendRanking(q, "na");
  const pop = populationRanking("na");
  const at = (id: string, xs: string[]) => xs.indexOf(id);
  const qr = completeRanking(q, "na");
  const sum = (id: string) => at(id, qr) + at(id, pop);
  // The blend is sorted by the sum of the two places.
  for (let i = 1; i < b.length; i++) assert.ok(sum(b[i - 1]!) <= sum(b[i]!));
  assert.ok(at("asheville-us-nc", b) < at("asheville-us-nc", pop), "Qloo lifts Asheville");
  assert.ok(at("knoxville-us-tn", b) < at("knoxville-us-tn", pop), "and Knoxville");
  assert.equal(new Set(b).size, pop.length);
});

test("R-precision: of a ranking's top R, how many the artist really played", () => {
  const truth = new Set(["a", "b", "c", "d"]);
  assert.deepEqual(rPrecision(["a", "x", "c", "y", "b"], truth), { hits: 2, of: 4, ids: ["a", "c"] });
  assert.equal(rPrecision(["a", "b", "c", "d", "x"], truth).hits, 4);
});

test("beyond the biggest cities: the real tour's stops outside population's top R", () => {
  const pop = populationRanking("na");
  const small = "asheville-us-nc";
  const truth = new Set([pop[0]!, pop[1]!, small]);
  const r = beyondBiggest([small, pop[5]!, pop[6]!], truth, "na");
  assert.deepEqual(r, { hits: 1, of: 1, ids: [small] });
  assert.equal(beyondBiggest(pop, truth, "na").hits, 0, "population finds none of them by construction");
});

test("eight-pick precision leaves unplaced stops out", () => {
  assert.deepEqual(precision(["a", undefined, "b", "z"], new Set(["a", "b"])), { hits: 2, of: 3, ids: ["a", "b"] });
});

test("the sign test is exact and two-sided; ties are dropped", () => {
  assert.equal(signTest([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]).p, 2 / 1024);
  assert.equal(signTest([1, -1, 1, -1, 0]).p, 1);
  const s = signTest([0.1, 0.2, -0.1, 0, 0.3, 0.1, 0.2]);
  assert.deepEqual([s.wins, s.losses, s.ties], [5, 1, 1]);
  assert.ok(Math.abs(s.p - 0.21875) < 1e-12);
});

test("the bootstrap interval is seeded and brackets the mean", () => {
  const d = [0.1, -0.05, 0.2, 0, 0.15, 0.05, -0.1, 0.3];
  const a = meanCI(d), b = meanCI(d);
  assert.deepEqual(a, b);
  assert.ok(a.lo <= a.mean && a.mean <= a.hi);
  assert.ok(Math.abs(a.mean - 0.08125) < 1e-12);
});

/* ───────────── reading a Wikipedia tour article ───────────── */

const ARTICLE = `{{Infobox concert
| artist = [[Example Band]]
}}
== Tour dates ==
{| class="wikitable"
|+ List of 2025 concerts
! Date
! City
! Country
! Venue
|-
! scope="row" | March 1
| rowspan="2" | [[Portland, Oregon|Portland]]
| rowspan="5" | United States
| rowspan="2" | [[Crystal Ballroom]]
|-
! scope="row" | March 2
|-
! scope="row" | March 4
| [[Morrison, Colorado|Morrison]]
| [[Red Rocks Amphitheatre]]
|-
! scope="row" | March 6
| [[Indio, California|Indio]]
| [[Coachella Valley Music and Arts Festival|Coachella]]
|-
! scope="row" | March 8
| [[Chicago]]
| [[Metro (Chicago)|Metro]]{{efn|Postponed from February.}}
|-
| March 10 || [[Toronto]] || Canada || [[Massey Hall]]
|}

=== Cancelled shows ===
{| class="wikitable"
! Date
! City
! Country
! Venue
|-
| March 12 || [[Boston]] || United States || [[Roadrunner]]
|}`;

test("show rows: rowspans carried down, festivals, postponed rows and cancelled sections left out", () => {
  const rows = showRows(ARTICLE);
  assert.deepEqual(
    rows.map((r) => [r.date, r.city, r.country]),
    [
      ["March 1", "Portland, Oregon", "United States"],
      ["March 2", "Portland, Oregon", "United States"],
      ["March 4", "Morrison, Colorado", "United States"],
      ["March 10", "Toronto", "Canada"],
    ],
  );
  assert.equal(rows[1]!.venue, "Crystal Ballroom");
});

test("markets by region: by name, else the nearest market to the town's coordinates", () => {
  const rows = showRows(ARTICLE);
  assert.deepEqual(marketsByRegion(rows).na, ["portland-us-or", "toronto-ca"]);
  assert.deepEqual(marketsByRegion(rows, { "Morrison, Colorado": [39.65, -105.19] }).na, ["portland-us-or", "denver-us-co", "toronto-ca"]);
});

test("the infobox artist, and no artist for a co-headline tour", () => {
  assert.equal(infoboxArtist(ARTICLE), "Example Band");
  assert.equal(infoboxArtist("| artist = [[Within Temptation]]\n"), "Within Temptation");
  assert.equal(infoboxArtist("| artist = [[Clairo (singer)|Clairo]]\n"), "Clairo");
  assert.equal(infoboxArtist("| artist = {{hlist|[[A]]|[[B]]}}\n"), undefined);
  assert.equal(infoboxArtist("| artist = [[Green Day]] and [[Smashing Pumpkins]]\n"), undefined);
});
