import { test } from "node:test";
import assert from "node:assert/strict";
import { planTour, populationPlan, table, type Ask, type PlanDeps } from "../lib/agent/plan.ts";
import { blendOrder, diffLine, qlooDiff, sizeRanks } from "../lib/agent/qloodiff.ts";
import { findMarket, marketId, marketLabel } from "../lib/geo/markets.ts";
import { blendRanking, populationRanking } from "../lib/headtohead.ts";
import type { CityScore, LogLine, Room } from "../lib/types.ts";

/** A small-city fan map, Sierra Ferrell style: Asheville first, the big cities further down. */
const city = (s: string, rank: number): CityScore => {
  const m = findMarket(s);
  assert.ok(m, `no market for ${s}`);
  return { marketId: marketId(m), name: m.name, label: marketLabel(m), lat: m.lat, lon: m.lon, affinity: Math.round((1 - rank * 0.02) * 1000) / 1000, tiles: 2, rank };
};
const FAN = ["Asheville", "Knoxville", "Chattanooga", "Lexington", "Nashville", "Louisville", "Roanoke", "Atlanta", "Chicago", "Houston"].map((n, i) => city(n, i + 1));
const NASHVILLE = FAN.find((c) => c.name === "Nashville")!;

test("the blend orders the fan map by fan rank and size rank averaged, and keeps Qloo's rank on every city", () => {
  const { ordered, ranks } = blendOrder(FAN, "na");
  const want = blendRanking(FAN.map((c) => c.marketId), "na").filter((id) => FAN.some((c) => c.marketId === id));
  assert.deepEqual(ordered.map((c) => c.marketId), want);
  assert.notDeepEqual(ordered.map((c) => c.marketId), FAN.map((c) => c.marketId), "size moves the order");
  assert.ok(ordered.findIndex((c) => c.name === "Chicago") < ordered.findIndex((c) => c.name === "Roanoke"), "a big city with fans rises past a small one ranked just above it");
  assert.equal(ordered.find((c) => c.name === "Asheville")!.rank, 1, "the fan rank is untouched");
  assert.equal(ranks.blend.get(ordered[0]!.marketId), 1);
  assert.equal(ranks.pop.get(populationRanking("na")[0]!), 1);
});

test("the agent's table shows blend rank, fan rank and size rank side by side; the pre-registered table is unchanged", () => {
  const { ordered, ranks } = blendOrder(FAN, "na");
  const t = table(ordered, NASHVILLE, 150, ranks);
  assert.match(t, /^city_id \| city \| blend rank \(fan rank and size rank averaged\) \| fan rank on Qloo \| size rank by metro population \| fan affinity/);
  const ash = FAN[0]!;
  assert.match(t, new RegExp(`${ash.marketId} \\| ${ash.label} \\| #${ranks.blend.get(ash.marketId)} \\| #1 \\| #${sizeRanks("na").get(ash.marketId)} \\| affinity 98 \\| [\\d,]+ people \\| \\d+ km from start`));
  const old = table(FAN, NASHVILLE, 150);
  assert.match(old, /^city_id \| city \| strength rank \| fan affinity \(0-100\) \| taste signal \(0-100\) \| distance\n/);
  assert.match(old, new RegExp(`${ash.marketId} \\| ${ash.label} \\| #1 \\| affinity 98 \\| \\d+ km from start`));
});

test("the size-only plan runs the same rules on population alone, with no lookups", async () => {
  const shows = 6;
  const plan = await populationPlan({ cities: FAN, region: "na", shows, from: NASHVILLE, usable: () => true });
  assert.equal(plan.length, shows);
  const top = new Set(populationRanking("na").slice(0, 60));
  assert.ok(plan.every((id) => top.has(id)), "big cities only");
  assert.ok(!plan.includes(FAN[0]!.marketId), "Asheville isn't a big city");
  // A city this run already looked up and found no rooms in is skipped.
  const first = plan[0]!;
  const without = await populationPlan({ cities: FAN, region: "na", shows, from: NASHVILLE, usable: (id) => id !== first });
  assert.ok(!without.includes(first));
});

test("the diff lists the cities Qloo added with its evidence, and what size alone would play instead", () => {
  const tour = ["Asheville", "Knoxville", "Nashville", "Chicago"].map((n) => FAN.find((c) => c.name === n)!).map((c) => ({ marketId: c.marketId, name: c.name }));
  const pop = [FAN.find((c) => c.name === "Chicago")!.marketId, ...populationRanking("na").filter((id) => !FAN.some((c) => c.marketId === id)).slice(0, 3)];
  const d = qlooDiff(tour, pop, FAN, "na");
  assert.equal(d.kept, 1);
  assert.deepEqual(d.added.map((a) => a.city), ["Asheville", "Knoxville", "Nashville"]);
  assert.deepEqual(d.added[0], { marketId: FAN[0]!.marketId, city: "Asheville", fanRank: 1, popRank: sizeRanks("na").get(FAN[0]!.marketId), affinity: FAN[0]!.affinity });
  assert.equal(d.dropped.length, 3);
  assert.ok(d.dropped.every((x) => x.fanRank === undefined), "no fan signal in those cities");
  assert.deepEqual(d.dropped.map((x) => x.popRank), [...d.dropped.map((x) => x.popRank)].sort((a, b) => a - b));
  const line = diffLine(d, 4);
  assert.equal(line.text, "Re-planned on city size alone (same rules, no Qloo, no model): Qloo changed 3 of 4 stops.");
  assert.match(line.result, /^Qloo added Asheville \(fan #1, size #\d+\), Knoxville/);
  assert.match(diffLine(qlooDiff(tour, tour.map((t) => t.marketId), FAN, "na"), 4).text, /picks the same 4 cities/);
});

test("every tour carries the diff, and the size-only plan costs no Qloo lookup", async () => {
  const looked: string[] = [];
  const deps: PlanDeps = {
    ask: (async () => {
      throw new Error("no model in this test");
    }) as Ask,
    lookUpRooms: async (_a, m) => {
      looked.push(m);
      return [{ id: `${m}-a`, name: `${m} Hall`, tags: [], affinity: 0.8 } satisfies Room];
    },
    lookUpOpeners: async () => [],
    roomCapacity: async () => null,
  };
  const lines: Omit<LogLine, "at">[] = [];
  const r = await planTour({ artist: { id: "a", name: "Test Artist", genres: [] }, audience: { age: {}, gender: {}, tags: [], trend: [], brands: [] }, cities: FAN, from: { lat: NASHVILLE.lat, lon: NASHVILLE.lon, label: NASHVILLE.label }, region: "na", shows: 5, useModel: false, log: (l) => lines.push(l) }, deps);
  assert.ok(r.qlooDiff);
  assert.equal(r.qlooDiff!.population.length, 5);
  assert.equal(r.qlooDiff!.kept + r.qlooDiff!.added.length, r.picks.length);
  assert.ok(looked.every((id) => FAN.some((c) => c.marketId === id)), `only fan-map cities are looked up: ${looked.join(", ")}`);
  assert.ok(r.qlooDiff!.population.some((id) => !looked.includes(id)), "the size-only plan's cities were never looked up");
  assert.ok(lines.some((l) => /^Re-planned on city size alone/.test(l.text)));
  assert.ok(lines.some((l) => /^Ordered the cities by fan rank weighed against city size/.test(l.text)));
});
