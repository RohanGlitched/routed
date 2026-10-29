import { test } from "node:test";
import assert from "node:assert/strict";
import { buyerBlock, radiusLine, withBuyerBlock } from "../lib/agent/evidence.ts";
import { roomNameMatches, sameRoomName } from "../lib/agent/plan.ts";
import { pickSupport, smallEnough } from "../lib/agent/rooms.ts";
import { readLine } from "../lib/log.ts";
import { neighbourhoodOf } from "../lib/osm.ts";
import type { Plan, Stop } from "../lib/types.ts";

/** Fixes from the Oct 29 judging round: each one a rule with a test. */

test("an operator's name before a room's own name is the same room (McMenamins Crystal Ballroom is the Crystal Ballroom)", () => {
  assert.ok(sameRoomName("Crystal Ballroom", "McMenamins Crystal Ballroom", ["portland"]));
  assert.ok(roomNameMatches("Crystal Ballroom", "McMenamins Crystal Ballroom", ["portland"]));
  assert.ok(sameRoomName("House of Blues", "House of Blues Boston", ["boston"]));
  assert.ok(!sameRoomName("Crystal Ballroom", "McMenamins Mission Theater", ["portland"]));
  assert.ok(!sameRoomName("The Basement", "The Basement East"));
});

test("the stored 'Qloo has no such room here' lines read as a search that didn't return the room, not a red failure", () => {
  const l = readLine({ at: "", kind: "qloo", text: "The agent suggested Crystal Ballroom in Portland; Qloo has no such room here.", failed: true });
  assert.equal(l.text, "The agent suggested Crystal Ballroom in Portland; Qloo's place search didn't return it there, so it isn't booked.");
  assert.equal(l.failed, undefined);
});

test("a support act sits well below the headliner: Lukas Nelson (0.84) loses the slot to Kelsey Waldon (0.59) under Sierra Ferrell (0.91)", () => {
  const lukas = { id: "lukas", name: "Lukas Nelson & Promise of the Real", popularity: 0.84, affinity: 0.97 };
  const kelsey = { id: "kelsey", name: "Kelsey Waldon", popularity: 0.592, affinity: 0.98 };
  assert.ok(!smallEnough(lukas, 0.914));
  assert.ok(smallEnough(kelsey, 0.914));
  const stops = [1, 2, 3].map(() => ({ openers: [lukas, kelsey], openerId: "lukas" }));
  assert.equal(pickSupport(stops)?.id, "lukas", "the agent's vote without the headliner's size");
  assert.equal(pickSupport(stops, 0.914)?.id, "kelsey");
  // Nothing small enough: the vote stands rather than no support at all.
  assert.equal(pickSupport([{ openers: [lukas], openerId: "lukas" }], 0.914)?.id, "lukas");
});

test("every hold request carries the buyer's fields, and the radius only when the run keeps it", () => {
  const at = (city: string, lat: number, lon: number) => ({ city, marketId: city, lat, lon }) as Stop;
  const plan = { region: "na", stops: [at("Nashville", 36.16, -86.78), at("Asheville", 35.6, -82.55), at("Murfreesboro", 35.85, -86.39)] } as Pick<Plan, "stops" | "region">;
  assert.equal(radiusLine(plan, plan.stops[1]!), "Radius: no other show on this run within 150 km of Asheville.");
  assert.match(radiusLine(plan, plan.stops[0]!)!, /^Radius: Murfreesboro \(\d+ km\) also plays this run, inside a 150 km radius, so ask whether this date can be carved out/);
  const block = buyerBlock(plan, plan.stops[1]!);
  for (const f of ["Ticket price range", "guarantee vs", "Set lengths", "Last play in Asheville", "within 150 km"]) assert.ok(block.includes(f), f);
  const body = withBuyerBlock("Hi,\n\nCould we hold May 7?\n\nThanks,", block);
  assert.ok(body.indexOf("For the offer") < body.indexOf("Thanks,"));
  assert.equal(withBuyerBlock(body, block), body, "idempotent");
});

test("OpenStreetMap's most local name that isn't the city names the neighbourhood", () => {
  assert.equal(neighbourhoodOf({ neighbourhood: "Downtown Nashville", suburb: "East Nashville", city: "Nashville" }, "Nashville"), "Downtown Nashville");
  assert.equal(neighbourhoodOf({ suburb: "Nashville", city_district: "Davidson County" }, "Nashville"), undefined);
  assert.equal(neighbourhoodOf({ quarter: "Over-the-Rhine" }, "Cincinnati"), "Over-the-Rhine");
});

test("a place Qloo files under a kind its name contradicts is labelled by its name", async () => {
  const { placeKind } = await import("../lib/agent/reannotate.ts");
  assert.equal(placeKind("Sun Studio", "Record store"), "Studio and museum");
  assert.equal(placeKind("Seattle Antiques Market", "Record store"), "Market");
  assert.equal(placeKind("Grimey's New & Preloved Music", "Record store"), "Record store");
});

test("re-annotating the stored flagship keeps its cities, books a support act well below the headliner, and says 'fits' only at 85-130%", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const { reannotate } = await import("../lib/agent/reannotate.ts");
  const { snugFit } = await import("../lib/agent/evidence.ts");
  const path = "../backups/tours-2026-10-30-pre/8v4ce57nx6.json";
  if (!existsSync(path)) return;
  const rec = JSON.parse(readFileSync(path, "utf8"));
  const { rec: out, changes } = reannotate(rec, { route: "keep", at: "2026-10-30T00:00:00Z" });
  assert.deepEqual(out.plan!.stops.map((s) => s.marketId).sort(), rec.plan.stops.map((s: { marketId: string }) => s.marketId).sort());
  assert.ok(changes.some((c) => c.startsWith("support: Lukas Nelson")));
  for (const s of out.plan!.stops) {
    const r = s.rooms.find((x) => x.id === s.roomId)!;
    if (/\bfits\b/.test(s.why!)) assert.ok(snugFit(r.capacity!.value, 1500), `${s.city}: ${s.why}`);
    assert.doesNotMatch(s.why!, /rule_pick|named_by_you|~~/);
  }
  assert.equal(reannotate(out, { route: "keep" }).changes.length, 0, "a second pass changes nothing");
});
