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
  assert.equal(radiusLine(plan, plan.stops[0]!), undefined, "Murfreesboro is 50 km away");
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
