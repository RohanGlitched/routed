import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cityKey, playedCount, realityCount, realityLead, realityMatches, realityMisses, realRooms, scaleLine, type RealityCheck } from "../components/tour/realityFacts.ts";

const data = JSON.parse(readFileSync(new URL("../data/flagship-reality.json", import.meta.url), "utf8")) as RealityCheck;

test("a state or an aside never stops a real stop matching Routed's city", () => {
  assert.equal(cityKey("Portland, OR"), "portland");
  assert.equal(cityKey("Morrison, CO (Denver area)"), "morrison");
  const m = realityMatches(data);
  const at = (city: string) => m[data.realCities.findIndex((c) => c.city === city)];
  assert.equal(at("Portland, OR"), "Portland");
  assert.equal(at("Morrison, CO (Denver area)"), "Denver");
  // Portland, ME is another city: Portland, OR claims Routed's Portland explicitly.
  assert.equal(at("Portland, ME"), undefined);
  assert.equal(at("Chicago, IL"), undefined);
  // Every Routed city on the headline tour has its real stop.
  for (const c of data.routedCities.filter((x) => x.onRealTour)) assert.ok(m.includes(c.city), c.city);
});

test("the state-stripped fallback matches when no stop claims the city", () => {
  const r = { realCities: [{ city: "Seattle, WA", played: true, venue: "x" }, { city: "Portland, ME", played: true, venue: "y" }], routedCities: [{ city: "Seattle", onRealTour: true }, { city: "Portland", onRealTour: false }] };
  assert.deepEqual(realityMatches(r), ["Seattle", "Portland"]);
  const claimed = { ...r, realCities: [...r.realCities, { city: "Troutdale, OR", played: true, venue: "z", routedCity: "Portland" }] };
  assert.deepEqual(realityMatches(claimed), ["Seattle", undefined, "Portland"]);
});

test("the counts come from the stored listings: 2 of 8 headline, 6 of 8 played, Cincinnati and Memphis missed", () => {
  assert.deepEqual(realityCount(data), { on: 2, of: 8 });
  assert.deepEqual(playedCount(data), { played: 6, of: 8, years: "2024–26" });
  assert.deepEqual(realityMisses(data), ["Cincinnati", "Memphis"]);
  for (const c of data.routedCities) if (c.played) assert.match(c.played.source, /^https:\/\//);
});

test("the scale line reads its range from the real rooms' capacities", () => {
  assert.deepEqual(realRooms(data), { min: 1850, max: 9525, n: 9 });
  assert.equal(scaleLine(data)?.replace(/⁠/g, ""), "Routed at her 2024-scale crowd (1,500); her 2026 rooms run 1,850–9,525");
  assert.equal(scaleLine({ ...data, realCities: data.realCities.map(({ capacity, capacitySource, ...c }) => c) }), undefined);
});

test("the lead names Qloo's top fan city where she closed a tour, with its ranks from the tour's diff", () => {
  const diff = { added: [{ marketId: "asheville-us-nc", city: "Asheville", fanRank: 1, popRank: 238, affinity: 0.999 }] };
  assert.deepEqual(realityLead(data, diff), { city: "Asheville", text: "Qloo's #1 fan city, #238 by size, is where she closed her 2025 tour" });
  assert.equal(realityLead(data), undefined);
});
