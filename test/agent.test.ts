import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan, planTour, sameRoomName, type Ask, type BookStop, type PlanDeps } from "../lib/agent/plan.ts";
import { findMarket, marketId, marketLabel } from "../lib/geo/markets.ts";
import { longLegs, MAX_LEG_KM, orderStops } from "../lib/geo/route.ts";
import type { Msg } from "../lib/nebius.ts";
import type { Artist, Audience, CityScore, LogLine, Room } from "../lib/types.ts";

/**
 * The agent itself, with its I/O faked: a scripted model and Qloo/web lookups from fixtures. Nothing here
 * calls Qloo, Nebius or the web.
 */

const city = (s: string, rank: number): CityScore => {
  const m = findMarket(s);
  assert.ok(m, `no market for ${s}`);
  return { marketId: marketId(m), name: m.name, label: marketLabel(m), lat: m.lat, lon: m.lon, affinity: Math.round((1 - rank * 0.03) * 1000) / 1000, tiles: 3, rank };
};

const CITIES = ["Denver", "Boulder", "Salt Lake City", "Albuquerque", "Omaha", "Wichita", "Boise", "Tulsa"].map((n, i) => city(n, i + 1));
const id = (name: string) => CITIES.find((c) => c.name === name)!.marketId;
const DENVER = CITIES[0]!;
const artist: Artist = { id: "artist-1", name: "Test Artist", genres: ["indie folk"] };
const audience: Audience = { age: {}, gender: {}, tags: [], trend: [], brands: [] };

type Answer = (name: string, messages: Msg[]) => unknown;

/** A scripted model; every call's name is recorded. */
function model(answer: Answer, calls: string[] = []): Ask {
  return (async (o: Parameters<Ask>[0]) => {
    calls.push(o.name);
    return { data: answer(o.name, o.messages), model: "fake/model" };
  }) as Ask;
}

/** `rooms` rooms in every city (two by default), one opener everywhere; capacities from `caps` (none by default). */
function tools(ask: Ask, caps: Record<string, number> = {}, rooms = 2): PlanDeps {
  return {
    ask,
    lookUpRooms: async (_a, m) => {
      return "abcdef".slice(0, rooms).split("").map((k, i): Room => ({ id: `${m}-${k}`, name: `${m} Hall ${k.toUpperCase()}`, affinity: 0.9 - i * 0.1, popularity: 0.7, tags: ["Music venue"] }));
    },
    lookUpOpeners: async () => [{ id: "op1", name: "Opener One", affinity: 0.8, shared: [] }],
    roomCapacity: async (r) => (caps[r.id] ? { value: caps[r.id]!, source: "https://example.org/", quote: "capacity" } : null),
  };
}

const stop = (cityId: string, room = "a"): BookStop => ({ city_id: cityId, room_id: `${cityId}-${room}`, opener_id: "op1", why: `${cityId} is a strong city for these fans.` });
const lastUser = (messages: Msg[]) => String(messages.filter((m) => m.role === "user").at(-1)?.content ?? "");

function run(deps: PlanDeps, extra: Partial<Parameters<typeof planTour>[0]> = {}) {
  const lines: Omit<LogLine, "at">[] = [];
  const p = planTour({ artist, audience, cities: CITIES, from: { lat: DENVER.lat, lon: DENVER.lon, label: DENVER.label }, region: "na", shows: 3, useModel: true, log: (l) => lines.push(l), ...extra }, deps);
  return { p, lines };
}

test("Boulder booked next to Denver: check_plan sends the radius clause back, and the agent re-chooses", async () => {
  const calls: string[] = [];
  const ask = model((name, messages) => {
    if (name === "shortlist") return { cities: [id("Denver"), id("Boulder"), id("Salt Lake City")].map((c) => ({ city_id: c, why: "strong" })), alternates: [id("Albuquerque")] };
    if (name === "book") return { stops: [stop(id("Denver")), stop(id("Boulder")), stop(id("Salt Lake City"))] };
    if (name === "rebook") {
      assert.match(lastUser(messages), /Boulder is 39 km from Denver, inside the 150 km radius clause/);
      return { stops: [stop(id("Denver")), stop(id("Albuquerque")), stop(id("Salt Lake City"))] };
    }
    throw new Error(`unexpected call ${name}`);
  }, calls);
  const { p, lines } = run(tools(ask));
  const r = await p;
  assert.equal(r.planned, "model");
  assert.deepEqual(r.picks.map((x) => x.marketId).sort(), [id("Albuquerque"), id("Denver"), id("Salt Lake City")].sort());
  assert.deepEqual(calls, ["shortlist", "book", "rebook"], "one revision, and no reasons call when nothing went stale");
  assert.deepEqual(r.check, { before: 1, after: 0, rounds: 1, revised: 1, ruled: 0, stops: 3, suggested: 0 });
  const revision = lines.find((l) => l.swaps?.length);
  assert.ok(revision, "the call sheet shows the revision");
  assert.deepEqual(revision!.swaps, [{ proposed: "Boulder", objection: "39 km from Denver (radius clause)", chose: "Albuquerque" }]);
  // The stops keep the agent's own reasons: no rule rewrote them.
  assert.ok(r.picks.every((x) => x.why?.endsWith("is a strong city for these fans.")));
});

test("an invented city_id is rejected: sent back twice, then dropped and the ranking fills the slot", async () => {
  const calls: string[] = [];
  const ask = model((name, messages) => {
    if (name === "shortlist") return { cities: [id("Denver"), id("Salt Lake City"), "atlantis-xx"].map((c) => ({ city_id: c, why: "strong" })), alternates: [] };
    if (name === "book" || name === "rebook") {
      if (name === "rebook") assert.match(lastUser(messages), /"atlantis-xx" isn't one of the candidate cities/);
      return { stops: [stop(id("Denver")), stop(id("Salt Lake City")), stop("atlantis-xx")] };
    }
    throw new Error(`unexpected call ${name}`);
  }, calls);
  const { p, lines } = run(tools(ask));
  const r = await p;
  assert.equal(r.planned, "model");
  assert.equal(r.picks.length, 3);
  assert.ok(!r.picks.some((x) => x.marketId === "atlantis-xx"));
  assert.ok(r.picks.some((x) => x.marketId === id("Denver")) && r.picks.some((x) => x.marketId === id("Salt Lake City")));
  assert.deepEqual(calls, ["shortlist", "book", "rebook", "rebook", "rebook", "reasons"], "at most three revision rounds, then the reasons for the stop the rules filled");
  assert.equal(r.check!.rounds, 3);
  assert.equal(r.check!.before, 1, "the invented city (the stop it leaves short isn't counted twice)");
  assert.equal(r.check!.after, 1);
  assert.equal(r.check!.ruled, 1, "the rules filled one stop");
  assert.ok(lines.some((l) => /The agent booked 2 usable stops; the ranking filled the other 1\./.test(l.text)));
  // The filled stop gets the rule's sentence, built from evidence only.
  const filled = r.picks.find((x) => ![id("Denver"), id("Salt Lake City")].includes(x.marketId))!;
  assert.match(filled.why!, /^.+ is Test Artist's #\d+ city on Qloo, and .+ matches these fans at \d+\.$/);
});

test("a re-booking that makes things worse is set aside: the earlier booking stands, the agent hears why, and the next round clears it", async () => {
  const calls: string[] = [];
  const prompts: string[] = [];
  const ask = model((name, messages) => {
    if (name === "shortlist") return { cities: [id("Denver"), id("Boulder"), id("Salt Lake City")].map((c) => ({ city_id: c, why: "strong" })), alternates: [id("Albuquerque")] };
    if (name === "book") return { stops: [stop(id("Denver")), stop(id("Boulder")), stop(id("Salt Lake City"))] };
    if (name === "rebook") {
      prompts.push(lastUser(messages));
      // Round 1 makes it worse (the radius clause still broken, and an invented city); round 2 fixes it.
      if (prompts.length === 1) return { stops: [stop(id("Denver")), stop(id("Boulder")), stop("atlantis-xx")] };
      return { stops: [stop(id("Denver")), stop(id("Albuquerque")), stop(id("Salt Lake City"))] };
    }
    throw new Error(`unexpected call ${name}`);
  }, calls);
  const { p, lines } = run(tools(ask));
  const r = await p;
  assert.deepEqual(calls, ["shortlist", "book", "rebook", "rebook"]);
  assert.match(prompts[0]!, /Cities that clear it: .*albuquerque/i, "the radius objection names cities that clear it");
  assert.match(prompts[1]!, /Your round 1 re-booking .* left \d objections, no fewer than the 1 before, so it was set aside/);
  assert.match(prompts[1]!, /Boulder is 39 km from Denver/, "round 2 starts again from the best booking, not the worse one");
  assert.ok(lines.some((l) => /so the earlier booking stands/.test(l.result ?? "")));
  assert.ok(lines.some((l) => /The agent cleared all 1 of check_plan's objections itself, in 2 rounds\./.test(l.text)));
  assert.deepEqual(r.check, { before: 1, after: 0, rounds: 2, revised: 1, ruled: 0, stops: 3, suggested: 0 });
  assert.deepEqual(r.picks.map((x) => x.marketId).sort(), [id("Albuquerque"), id("Denver"), id("Salt Lake City")].sort());
});

test("when every re-booking is worse, the agent's first booking is the one the rules settle", async () => {
  const ask = model((name) => {
    if (name === "shortlist") return { cities: [id("Denver"), id("Boulder"), id("Salt Lake City")].map((c) => ({ city_id: c, why: "strong" })), alternates: [] };
    if (name === "book") return { stops: [stop(id("Denver")), stop(id("Boulder")), stop(id("Salt Lake City"))] };
    if (name === "rebook") return { stops: [stop(id("Denver")), stop(id("Boulder")), stop("atlantis-xx")] };
    return { reasons: [] };
  });
  const { p, lines } = run(tools(ask));
  const r = await p;
  assert.equal(r.check!.rounds, 3);
  assert.equal(r.check!.after, 1, "the first booking's one objection, not the worse answers' two");
  assert.ok(lines.some((l) => /One objection still stands after the agent's 3 revisions \(the agent cleared 0 of 1\)/.test(l.text)));
  assert.ok(r.picks.some((x) => x.marketId === id("Salt Lake City")), "the first booking's Salt Lake City, not the invented city's slot");
});

test("rooms are measured before booking, and after the rules settle the agent writes the reasons for stops a rule changed", async () => {
  const calls: string[] = [];
  // Denver's sixth room is the only one with a capacity on record: the four measured before booking find nothing,
  // so the check can't object to the agent's room, and the room rule switches it once the sixth is measured.
  const caps = { [`${id("Denver")}-f`]: 1400 };
  const ask = model((name, messages) => {
    if (name === "shortlist") return { cities: [id("Denver"), id("Salt Lake City"), id("Albuquerque")].map((c) => ({ city_id: c, why: "strong" })), alternates: [] };
    if (name === "book") return { stops: [stop(id("Denver")), stop(id("Salt Lake City")), stop(id("Albuquerque"))] };
    if (name === "reasons") {
      assert.match(lastUser(messages), /Room: denver-us-co Hall F, holds 1400/);
      return { reasons: [{ city_id: id("Denver"), why: "Denver is #1 on Qloo for these fans, and Hall F holds 1400." }] };
    }
    throw new Error(`unexpected call ${name}`);
  }, calls);
  const { p, lines } = run(tools(ask, caps, 6), { draw: 1200 });
  const r = await p;
  assert.ok(lines.some((l) => /^Measured the likeliest rooms in the 3 shortlisted cities before booking/.test(l.text)), "rooms are measured before the book call");
  assert.ok(lines.some((l) => /^check_plan: the agent's booking clears every rule/.test(l.text)));
  assert.deepEqual(calls, ["shortlist", "book", "reasons"]);
  const denver = r.picks.find((x) => x.marketId === id("Denver"))!;
  assert.equal(denver.roomId, `${id("Denver")}-f`, "the room rule books the room that fits");
  assert.equal(denver.why, "Denver is #1 on Qloo for these fans, and Hall F holds 1400.");
  assert.deepEqual(r.check, { before: 0, after: 0, rounds: 0, revised: 0, ruled: 1, stops: 3, suggested: 0 });
});

test("a room that doesn't fit is objected to before the rules step in, and the agent re-books it", async () => {
  const calls: string[] = [];
  const caps = { [`${id("Denver")}-a`]: 300, [`${id("Denver")}-b`]: 1400 };
  const ask = model((name, messages) => {
    if (name === "shortlist") return { cities: [id("Denver"), id("Salt Lake City"), id("Albuquerque")].map((c) => ({ city_id: c, why: "strong" })), alternates: [] };
    if (name === "book") return { stops: [stop(id("Denver")), stop(id("Salt Lake City")), stop(id("Albuquerque"))] };
    if (name === "rebook") {
      assert.match(lastUser(messages), /denver-us-co Hall A holds 300 \(too small for about 1,200\); the room rule would book denver-us-co Hall B/);
      return { stops: [stop(id("Denver"), "b"), stop(id("Salt Lake City")), stop(id("Albuquerque"))] };
    }
    throw new Error(`unexpected call ${name}`);
  }, calls);
  const { p, lines } = run(tools(ask, caps), { draw: 1200 });
  const r = await p;
  assert.deepEqual(calls, ["shortlist", "book", "rebook"]);
  assert.equal(r.picks.find((x) => x.marketId === id("Denver"))!.roomId, `${id("Denver")}-b`);
  assert.deepEqual(r.check, { before: 1, after: 0, rounds: 1, revised: 1, ruled: 0, stops: 3, suggested: 0 });
  assert.deepEqual(lines.find((l) => l.swaps?.length)!.swaps, [{ proposed: "denver-us-co Hall A, Denver", objection: "denver-us-co Hall A holds 300, too small", chose: "denver-us-co Hall B" }]);
});

test("a model error falls back to the fixed plan", async () => {
  const ask = model(() => {
    throw new Error("HTTP 500");
  });
  const { p, lines } = run(tools(ask));
  const r = await p;
  assert.equal(r.planned, "fixed");
  assert.equal(r.picks.length, 3);
  assert.equal(r.check, undefined);
  assert.ok(lines.some((l) => l.failed && /the fixed plan takes over/.test(l.text)));
  assert.ok(lines.some((l) => /^Fixed plan: the 3 top cities in blend order/.test(l.text)));
  // The fixed plan still clears the radius clause: never Denver and Boulder together.
  assert.ok(!(r.picks.some((x) => x.marketId === id("Denver")) && r.picks.some((x) => x.marketId === id("Boulder"))));
});

test("a model that never answers falls back to the fixed plan within the deadline", async () => {
  const never = (() => new Promise(() => {})) as Ask;
  const t = Date.now();
  const { p, lines } = run(tools(never), { deadline: Date.now() + 400, minCallMs: 100 });
  const r = await p;
  assert.equal(r.planned, "fixed");
  assert.equal(r.picks.length, 3);
  assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`);
  assert.ok(lines.some((l) => l.failed && /the fixed plan takes over/.test(l.text)));
});

test("a revision that never answers leaves the rest to the rules, in time", async () => {
  const calls: string[] = [];
  const answer = model((name) => {
    if (name === "shortlist") return { cities: [id("Denver"), id("Boulder"), id("Salt Lake City")].map((c) => ({ city_id: c, why: "strong" })), alternates: [] };
    return { stops: [stop(id("Denver")), stop(id("Boulder")), stop(id("Salt Lake City"))] };
  }, calls);
  const ask = ((o: Parameters<Ask>[0]) => (o.name === "rebook" ? new Promise(() => {}) : answer(o))) as Ask;
  const t = Date.now();
  const { p, lines } = run(tools(ask), { deadline: Date.now() + 500, minCallMs: 100 });
  const r = await p;
  assert.ok(Date.now() - t < 2000);
  assert.equal(r.planned, "model");
  assert.ok(lines.some((l) => l.failed && /didn't answer the check/.test(l.text)));
  assert.ok(!r.picks.some((x) => x.marketId === id("Boulder")), "the guard still drops Boulder");
  assert.equal(r.picks.length, 3);
});

test("check_plan: room fit and the leg cap", () => {
  const seattle = city("Seattle", 1), miami = city("Miami", 2);
  const rooms = new Map<string, Room[]>([
    [seattle.marketId, [{ id: "s-small", name: "Small Club", tags: [], capacity: { value: 200, source: "https://x.org", quote: "" } }, { id: "s-big", name: "Big Hall", tags: [], capacity: { value: 1500, source: "https://x.org", quote: "" } }]],
    [miami.marketId, [{ id: "m-a", name: "Miami Room", tags: [] }]],
  ]);
  const out = checkPlan(
    [
      { city_id: seattle.marketId, room_id: "s-small", opener_id: "o", why: "" },
      { city_id: miami.marketId, room_id: "m-a", opener_id: "o", why: "" },
    ],
    { byId: new Map([seattle, miami].map((c) => [c.marketId, c])), rooms, shows: 2, draw: 1200, from: seattle, radius: 150 },
  );
  assert.deepEqual(out.map((o) => o.rule).sort(), ["leg", "room"]);
  assert.match(out.find((o) => o.rule === "room")!.text, /the room rule would book Big Hall \(s-big\), which holds 1,500 \(a close fit for about 1,200\)/);
  assert.match(out.find((o) => o.rule === "leg")!.text, /Seattle to Miami is [\d,]+ km of road with no show between/);
});

/* ───────────── the fan anchors and the fan cap (Oct 25 smoke tour: Sierra Ferrell from Nashville, 8 shows, 1,500) ───────────── */

const SMOKE = ["Asheville", "Nashville", "Portland, OR", "Denver", "Austin", "Santa Fe", "Boulder", "Knoxville", "Lexington", "Louisville", "Bend", "Boise", "Salt Lake City", "Kansas City", "St. Louis", "Memphis", "Chattanooga", "Tulsa", "Oklahoma City", "Albuquerque", "Missoula", "Spokane", "Omaha", "Birmingham, AL", "Little Rock", "Charlotte", "Raleigh", "Richmond", "Pittsburgh", "Cincinnati", "Indianapolis", "Detroit", "Atlanta", "Savannah", "Columbus, OH", "Houston", "Dallas", "Phoenix", "Los Angeles", "San Francisco", "Seattle", "Philadelphia", "New York", "Boston", "Washington", "Miami", "Minneapolis", "San Diego", "Toronto", "Chicago"].map((n, i) => city(n, i + 1));
const sid = (name: string) => SMOKE.find((c) => c.name === name)!.marketId;
const NASH = SMOKE[1]!;

function smoke(deps: PlanDeps, useModel: boolean) {
  const lines: Omit<LogLine, "at">[] = [];
  const p = planTour({ artist, audience, cities: SMOKE, from: { lat: NASH.lat, lon: NASH.lon, label: NASH.label }, region: "na", shows: 8, draw: 1500, useModel, log: (l) => lines.push(l) }, deps);
  return { p, lines };
}

test("the fixed plan keeps the top three fan cities and doesn't let city size lift Chicago (#50) or Columbus (#35)", async () => {
  const { p, lines } = smoke(tools(model(() => ({}))), false);
  const r = await p;
  const ids = r.picks.map((x) => x.marketId);
  for (const c of ["Asheville", "Nashville", "Portland"]) assert.ok(ids.includes(sid(c)), `${c} stays: ${ids.join(", ")}`);
  for (const c of ["Chicago", "Columbus"]) assert.ok(!ids.includes(sid(c)), `${c} isn't added: ${ids.join(", ")}`);
  assert.equal(r.picks.length, 8);
  assert.ok(lines.some((l) => /^Only Qloo's top 25 fan cities are candidates/.test(l.text) && /^Left out though city size lifts them: .*\(fan #(2[6-9]|[3-5]\d)\)/.test(l.result ?? "")), "the call sheet says why the big cities are out");
});

test("an agent that drops Asheville and Portland for Chicago and Columbus is objected to, and the rules keep the fan cities", async () => {
  const booking = ["Nashville", "Denver", "Austin", "Knoxville", "Lexington", "Louisville", "Chicago", "Columbus"].map((n) => stop(sid(n)));
  let objected = "";
  const ask = model((name, messages) => {
    if (name === "shortlist") {
      assert.match(lastUser(messages), /asheville-us-nc \| Asheville, NC \| #\d+ \| #1 \| .* \| MUST KEEP \(a top-3 fan city\)/);
      return { cities: booking.map((s) => ({ city_id: s.city_id, why: "big" })), alternates: [] };
    }
    if (name === "book") {
      assert.match(lastUser(messages), /"city_id":"asheville-us-nc"[^}]*"must_keep":true/, "Asheville is scouted and flagged even though the shortlist left it out");
      return { stops: booking };
    }
    if (name === "rebook") {
      objected = lastUser(messages);
      return { stops: booking };
    }
    return { reasons: [] };
  });
  const { p } = smoke(tools(ask), true);
  const r = await p;
  assert.match(objected, /Asheville \(asheville-us-nc\) is #1 on Qloo's fan map, one of the artist's 3 strongest fan cities/);
  assert.match(objected, /"chicago-us-il" isn't one of the candidate cities/);
  const ids = r.picks.map((x) => x.marketId);
  for (const c of ["Asheville", "Nashville", "Portland"]) assert.ok(ids.includes(sid(c)), `${c} stays: ${ids.join(", ")}`);
  for (const c of ["Chicago", "Columbus"]) assert.ok(!ids.includes(sid(c)), `${c} isn't added: ${ids.join(", ")}`);
});

test("check_plan: an unmeasured room loses to a measured room that fits, for a crowd of 1,000 or more", () => {
  const col = city("Columbus, OH", 5);
  const rooms = new Map<string, Room[]>([[col.marketId, [{ id: "wex", name: "Wexner Center for the Arts", tags: [], affinity: 0.95 }, { id: "kemba", name: "KEMBA Live!", tags: [], affinity: 0.7, capacity: { value: 2200, source: "https://x.org", quote: "" } }]]]);
  const out = checkPlan([{ city_id: col.marketId, room_id: "wex", opener_id: "o", why: "" }], { byId: new Map([[col.marketId, col]]), rooms, shows: 1, draw: 1500, from: col, radius: 150 });
  assert.equal(out.length, 1);
  assert.match(out[0]!.text, /Wexner Center for the Arts has no confirmed capacity; the room rule would book KEMBA Live! \(kemba\), which holds 2,200 \(a loose fit for about 1,500\)/);
});

/* ───────────── the bridge (second smoke tour: Portland kept, but Salt Lake City gave way and Denver lost to Boulder) ───────────── */

const BRIDGED = ["Asheville", "Nashville", "Portland, OR", "Denver", "Austin", "Santa Fe", "Boulder", "Knoxville", "Lexington", "Louisville", "Cincinnati", "New Orleans", "Chattanooga", "Birmingham, AL", "Little Rock", "Salt Lake City", "Tulsa", "Memphis", "St. Louis", "Kansas City", "Oklahoma City", "Albuquerque", "Atlanta", "Savannah", "Charlotte", "Raleigh", "Richmond", "Pittsburgh", "Indianapolis", "Boise", "Columbus, OH", "Houston", "Dallas", "Detroit", "Chicago"].map((n, i) => city(n, i + 1));
const bid = (name: string) => BRIDGED.find((c) => c.name === name)!.marketId;

/** The legs over the cap on the tour as run.ts routes it (the exact order, opening at the hometown). */
function overCap(r: Awaited<ReturnType<typeof planTour>>, from: CityScore): number[] {
  const at = r.picks.map((p) => ({ ...BRIDGED.find((c) => c.marketId === p.marketId)!, id: p.marketId }));
  return longLegs(from, orderStops(from, at, { max: MAX_LEG_KM, first: r.homeId }), MAX_LEG_KM).map((l) => l.km);
}

function bridged(deps: PlanDeps, useModel: boolean) {
  const nash = BRIDGED[1]!;
  const lines: Omit<LogLine, "at">[] = [];
  const p = planTour({ artist, audience, cities: BRIDGED, from: { lat: nash.lat, lon: nash.lon, label: nash.label }, region: "na", shows: 8, draw: 1500, useModel, log: (l) => lines.push(l) }, deps);
  return { p, lines, nash };
}

test("adding Portland never drops the bridge city: a mid-route stop gives way, Denver stays, and no leg is over 1,800 km", async () => {
  const booking = ["Nashville", "Asheville", "Cincinnati", "Memphis", "New Orleans", "Austin", "Denver", "Salt Lake City"].map((n) => stop(bid(n)));
  const ask = model((name) => (name === "shortlist" ? { cities: booking.map((s) => ({ city_id: s.city_id, why: "strong" })), alternates: [] } : name === "reasons" ? { reasons: [] } : { stops: booking }));
  const { p, lines, nash } = bridged(tools(ask), true);
  const r = await p;
  const ids = r.picks.map((x) => x.marketId);
  for (const c of ["Asheville", "Nashville", "Portland", "Denver", "Salt Lake City"]) assert.ok(ids.includes(bid(c)), `${c} stays: ${ids.join(", ")}`);
  assert.ok(!ids.includes(bid("Boulder")), "Denver isn't traded for Boulder");
  assert.deepEqual(overCap(r, nash), [], ids.join(", "));
  const fan = lines.find((l) => /^Portland is #3 on .* so it stays on the tour/.test(l.text));
  assert.ok(fan && !/Salt Lake City gives way/.test(fan.text), fan?.text);
  assert.ok(!lines.some((l) => /would cost a [\d,]+ km leg with no show, so Boulder/.test(l.text)));
});

test("the fixed plan reaches Portland with every leg under the cap, pulling in a bridge city when it must", async () => {
  const { p, lines, nash } = bridged(tools(model(() => ({}))), false);
  const r = await p;
  const ids = r.picks.map((x) => x.marketId);
  for (const c of ["Asheville", "Nashville", "Portland"]) assert.ok(ids.includes(bid(c)), `${c} stays: ${ids.join(", ")}`);
  assert.equal(r.picks.length, 8);
  assert.deepEqual(overCap(r, nash), [], ids.join(", "));
  assert.ok(!lines.some((l) => /still over/.test(l.text)), "no leg left to flag");
});

/* ───────────── rooms the agent names, found on Qloo ───────────── */

function namedTools(ask: Ask, places: Record<string, Room>, calls: { find: string[]; score: string[][] }): PlanDeps {
  return {
    ...tools(ask, { mission: 2000 }),
    findPlace: async (_a, name) => {
      calls.find.push(name);
      return places[name] ?? null;
    },
    scoreRooms: async (_a, ids) => {
      calls.score.push(ids);
      return new Map(ids.map((x) => [x, 0.97]));
    },
  };
}

test("a room the agent names, found on Qloo and measured to fit, beats Qloo's unmeasured rooms", async () => {
  const calls = { find: [] as string[], score: [] as string[][] };
  const mission: Room = { id: "mission", name: "Mission Ballroom", tags: ["Music venue"], popularity: 0.9, lat: DENVER.lat, lon: DENVER.lon };
  const models: string[] = [];
  const ask = model((name, messages) => {
    if (name === "shortlist") {
      assert.match(lastUser(messages), /also give "rooms": up to 2 music rooms there/);
      return { cities: [{ city_id: id("Denver"), why: "strong", rooms: ["Mission Ballroom", "Ogden Theatre"] }, { city_id: id("Salt Lake City"), why: "strong", rooms: [] }, { city_id: id("Albuquerque"), why: "strong", rooms: [] }], alternates: [] };
    }
    if (name === "book") {
      assert.match(lastUser(messages), /"id":"mission","name":"Mission Ballroom","affinity":97,[^}]*"capacity":2000,"size":"fits","rule_pick":true,"named_by_you":true/);
      return { stops: [stop(id("Denver")), stop(id("Salt Lake City")), stop(id("Albuquerque"))] };
    }
    if (name === "rebook") return { stops: [{ ...stop(id("Denver")), room_id: "mission" }, stop(id("Salt Lake City")), stop(id("Albuquerque"))] };
    return { reasons: [] };
  }, models);
  const { p, lines } = run(namedTools(ask, { "Mission Ballroom": mission }, calls), { draw: 1500 });
  const r = await p;
  assert.deepEqual(calls.find, ["Mission Ballroom", "Ogden Theatre"], "one place search per name");
  assert.deepEqual(calls.score, [["mission"]], "one affinity call for what was found");
  const denver = r.picks.find((x) => x.marketId === id("Denver"))!;
  assert.equal(denver.roomId, "mission");
  assert.equal(denver.rooms.find((x) => x.id === "mission")!.origin, "agent");
  assert.equal(r.check!.suggested, 1);
  assert.ok(lines.some((l) => !l.failed && l.text === "The agent suggested Ogden Theatre in Denver; Qloo's place search didn't return it there, so it isn't booked."));
  assert.ok(lines.some((l) => /^Looked up the rooms the agent named on Qloo/.test(l.text) && /1 found and added: Mission Ballroom \(Denver\)/.test(l.result ?? "")));
  assert.deepEqual(models, ["shortlist", "book", "rebook"], "the names ride on the shortlist call: no extra model call");
});

test("a room name Qloo can't find in the city is dropped, never booked, and said so", async () => {
  const calls = { find: [] as string[], score: [] as string[][] };
  const ask = model((name) => {
    if (name === "shortlist") return { cities: [{ city_id: id("Denver"), why: "strong", rooms: ["Atlantis Hall"] }, { city_id: id("Salt Lake City"), why: "strong", rooms: [] }, { city_id: id("Albuquerque"), why: "strong", rooms: [] }], alternates: [] };
    if (name === "book" || name === "rebook") return { stops: [{ ...stop(id("Denver")), room_id: "atlantis" }, stop(id("Salt Lake City")), stop(id("Albuquerque"))] };
    return { reasons: [] };
  });
  // Qloo's place search returns a different room for the name: it doesn't count as found.
  const { p, lines } = run(namedTools(ask, { "Atlantis Hall": { id: "other", name: "Bluebird Theater", tags: [] } }, calls));
  const r = await p;
  const denver = r.picks.find((x) => x.marketId === id("Denver"))!;
  assert.ok(!denver.rooms.some((x) => x.origin === "agent" || x.id === "other" || x.id === "atlantis"));
  assert.ok(denver.roomId?.startsWith(id("Denver")), "a room with a Qloo id from the city's own list");
  assert.deepEqual(calls.score, [], "nothing found, nothing to score");
  assert.ok(lines.some((l) => !l.failed && l.text === "The agent suggested Atlantis Hall in Denver; Qloo's place search didn't return it there, so it isn't booked."));
  assert.equal(r.check!.suggested, 0);
});

test("room names match the way venues are written, without merging two rooms", () => {
  assert.ok(sameRoomName("Ryman", "Ryman Auditorium"));
  assert.ok(sameRoomName("The Basement East", "Basement East"));
  assert.ok(sameRoomName("Mission Ballroom", "The Mission Ballroom"));
  assert.ok(!sameRoomName("The Basement", "The Basement East"));
  assert.ok(!sameRoomName("Ogden Theatre", "Bluebird Theater"));
});

/* ───────────── a bridge for a leg the agent booked itself (prod flagship ufa6g3z3cm: Denver to Portland, 1,895 km) ───────────── */

const FLAG = ["Asheville", "Nashville", "Portland, OR", "Denver", "Austin", "Santa Fe", "Boulder", "Knoxville", "Seattle", "Lexington", "Cincinnati", "Pittsburgh", "Louisville", "Chattanooga", "New Orleans", "Birmingham, AL", "Little Rock", "Memphis", "Tulsa", "St. Louis", "Kansas City", "Oklahoma City", "Albuquerque", "Salt Lake City", "Atlanta", "Charlotte", "Raleigh", "Indianapolis", "Columbus, OH", "Boise", "Houston", "Chicago"].map((n, i) => city(n, i + 1));
const fid = (name: string) => FLAG.find((c) => c.name === name)!.marketId;

test("a leg the agent booked over the cap gets a bridge city: Salt Lake City (#24) between Denver and Portland", async () => {
  assert.deepEqual([fid("Denver"), fid("Salt Lake City"), fid("Portland")].map((x) => FLAG.find((c) => c.marketId === x)!.lat.toFixed(1)), ["39.7", "40.8", "45.5"]);
  const booking = ["Nashville", "Asheville", "Pittsburgh", "Cincinnati", "Seattle", "Austin", "Denver", "Portland"].map((n) => stop(fid(n)));
  const ask = model((name) => (name === "shortlist" ? { cities: booking.map((s) => ({ city_id: s.city_id, why: "strong" })), alternates: [] } : name === "reasons" ? { reasons: [] } : { stops: booking }));
  const nash = FLAG[1]!;
  const lines: Omit<LogLine, "at">[] = [];
  // As on the prod run, the leg rule finds no swap that closes it: the cities that could replace an end have no
  // rooms on Qloo, and Salt Lake City (which bridges, but can't replace Denver) hasn't been looked up.
  const base = tools(ask);
  const noRooms = new Set(["Boulder", "Santa Fe", "Albuquerque", "Oklahoma City", "Tulsa", "Kansas City", "Boise"].map(fid));
  const deps: PlanDeps = { ...base, lookUpRooms: (a, m, l, d) => (noRooms.has(m) ? Promise.resolve([]) : base.lookUpRooms(a, m, l, d)) };
  const r = await planTour({ artist, audience, cities: FLAG, from: { lat: nash.lat, lon: nash.lon, label: nash.label }, region: "na", shows: 8, draw: 1500, useModel: true, log: (l) => lines.push(l) }, deps);
  const ids = r.picks.map((x) => x.marketId);
  for (const c of ["Asheville", "Nashville", "Portland", "Denver"]) assert.ok(ids.includes(fid(c)), `${c} stays: ${ids.join(", ")}`);
  assert.ok(ids.includes(fid("Salt Lake City")), `Salt Lake City bridges: ${ids.join(", ")}`);
  const at = r.picks.map((p) => ({ ...FLAG.find((c) => c.marketId === p.marketId)!, id: p.marketId }));
  const route = orderStops(nash, at, { max: MAX_LEG_KM, first: r.homeId });
  assert.equal(r.homeId, fid("Nashville"), "the run opens at home");
  assert.equal(route[0]!.name, "Nashville");
  assert.deepEqual(longLegs(nash, route, MAX_LEG_KM), [], route.map((x) => x.name).join(" → "));
  assert.ok(!lines.some((l) => /still over/.test(l.text)), lines.filter((l) => l.kind === "rule").map((l) => l.text).join(" | "));
  assert.ok(lines.some((l) => /^Denver to Portland is [\d,]+ km of road with no show, so Salt Lake City \(fan #24\) bridges it/.test(l.text)));
});

/* ───────────── agent-named rooms against Qloo's real /search names (probed Oct 26) ───────────── */

test("an agent's room name matches Qloo's name for it, aliases and 'at the …' included, and nothing else", async () => {
  const { roomNameMatches } = await import("../lib/agent/plan.ts");
  assert.ok(roomNameMatches("ACL Live at the Moody Theater", "Austin City Limits Live (ACL Live & 3TEN ACL Live)"));
  assert.ok(!roomNameMatches("ACL Live at the Moody Theater", "ACL Live Shop"), "the venue's shop isn't the room");
  assert.ok(roomNameMatches("Thomas Wolfe Auditorium", "Thomas Wolfe Auditorium"));
  assert.ok(!roomNameMatches("Thomas Wolfe Auditorium", "Thomas Wolfe Memorial State Historic Site"));
  assert.ok(roomNameMatches("Arlene Schnitzer Concert Hall", "Arlene Schnitzer Concert Hall"));
  assert.ok(!roomNameMatches("Arlene Schnitzer Concert Hall", "The Old Church Concert Hall"));
  assert.ok(roomNameMatches("The Paramount Theatre", "The Paramount Theatre"));
  assert.ok(!roomNameMatches("Paramount Theatre", "Ogden Theatre"));
  assert.ok(roomNameMatches("Tipitina's", "Tipitina's"));
});

test("Salt Lake City books the snug measured room, not the symphony's hall: Capitol Theatre (1,876) for 1,500", async () => {
  const { chooseRoom, orchestraHallFor, roomCheck } = await import("../lib/agent/rooms.ts");
  const cap = (value: number) => ({ value, source: "https://example.org/", quote: "capacity" });
  const rooms: Room[] = [
    { id: "metro", name: "Metro Music Hall", tags: [] },
    { id: "abravanel", name: "Abravanel Hall", tags: [], capacity: cap(2768) },
    { id: "eccles", name: "Eccles Theater", tags: [], capacity: cap(2468) },
    { id: "capitol", name: "Capitol Theatre", tags: [], capacity: cap(1876) },
  ];
  assert.equal(chooseRoom(rooms, "metro", 1500)!.id, "capitol", "a snug measured fit beats looser fits and the agent's unmeasured pick");
  assert.equal(roomCheck(rooms, "metro", 1500).room!.id, "capitol");
  // One jazz-flavoured tag among an americana act's genres doesn't open the Utah Symphony's hall.
  assert.equal(orchestraHallFor("Abravanel Hall", ["americana", "bluegrass", "folk", "country", "gypsy jazz"]), true);
  assert.equal(orchestraHallFor("Abravanel Hall", ["jazz", "vocal jazz", "swing"]), false);
});

/* ───────────── a booker's order among rooms that fit: close, then sells out, then loose ───────────── */

const capped = (id: string, name: string, value: number): Room => ({ id, name, tags: [], capacity: { value, source: "https://example.org/", quote: "capacity" } });

test("Portland: the Crystal Ballroom (1,500) is a closer fit than Arlene Schnitzer (2,776), and check_plan says so", async () => {
  const { chooseRoom, roomCheck, fitWord } = await import("../lib/agent/rooms.ts");
  const pdx = city("Portland, OR", 3);
  const rooms = [capped("schnitz", "Arlene Schnitzer Concert Hall", 2776), capped("crystal", "McMenamins Crystal Ballroom", 1500)];
  assert.equal(chooseRoom(rooms, "schnitz", 1500)!.id, "crystal", "the rule picks the close fit over the agent's loose one");
  assert.equal(roomCheck(rooms, "schnitz", 1500).room!.id, "crystal");
  assert.equal(fitWord(rooms[0]!, 1500), "a loose fit");
  const out = checkPlan([{ city_id: pdx.marketId, room_id: "schnitz", opener_id: "o", why: "" }], { byId: new Map([[pdx.marketId, pdx]]), rooms: new Map([[pdx.marketId, rooms]]), shows: 1, draw: 1500, from: pdx, radius: 150 });
  assert.equal(out.length, 1);
  assert.match(out[0]!.text, /^McMenamins Crystal Ballroom holds 1,500, a closer fit for about 1,500 than Arlene Schnitzer Concert Hall's 2,776 \(a loose fit\): book McMenamins Crystal Ballroom \(crystal\)/);
});

test("Asheville: the Orange Peel (1,050, sold out) beats Thomas Wolfe Auditorium (2,431, two-thirds full), and an agent that insists is overruled", async () => {
  const { chooseRoom, fitWord } = await import("../lib/agent/rooms.ts");
  const rooms = [capped("wolfe", "Thomas Wolfe Auditorium", 2431), capped("peel", "The Orange Peel", 1050)];
  assert.equal(fitWord(rooms[1]!, 1500), "one the fans sell out");
  assert.equal(chooseRoom(rooms, "wolfe", 1500)!.id, "peel");
  // A close fit still beats a room the fans sell out.
  assert.equal(chooseRoom([capped("peel", "The Orange Peel", 1050), capped("x", "Close Hall", 1600)], "peel", 1500)!.id, "x");

  // The agent books Thomas Wolfe and keeps it through both rounds: the rule swaps and says why.
  const caps = { [`${id("Denver")}-a`]: 2431, [`${id("Denver")}-b`]: 1050 };
  const calls: string[] = [];
  const ask = model((name, messages) => {
    if (name === "shortlist") return { cities: [id("Denver"), id("Salt Lake City"), id("Albuquerque")].map((c) => ({ city_id: c, why: "strong" })), alternates: [] };
    if (name === "rebook") assert.match(lastUser(messages), /denver-us-co Hall B holds 1,050, a closer fit for about 1,500 than denver-us-co Hall A's 2,431 \(a loose fit\)/);
    if (name === "book" || name === "rebook") return { stops: [stop(id("Denver")), stop(id("Salt Lake City")), stop(id("Albuquerque"))] };
    return { reasons: [] };
  }, calls);
  const { p, lines } = run(tools(ask, caps), { draw: 1500 });
  const r = await p;
  assert.deepEqual(calls.slice(0, 4), ["shortlist", "book", "rebook", "rebook"]);
  assert.equal(r.picks.find((x) => x.marketId === id("Denver"))!.roomId, `${id("Denver")}-b`);
  assert.ok(lines.some((l) => l.text === "denver-us-co Hall A holds 2,431, a loose fit for a crowd of about 1,500, and denver-us-co Hall B is closer, so Denver gets denver-us-co Hall B."), lines.filter((l) => l.kind === "rule").map((l) => l.text).join(" | "));
});

/* ───────────── Oct 26 wall re-runs: Wikidata namesakes, arenas Qloo files as stadiums, the Wikidata ladder ───────────── */

test("a Wikidata item that only shares a word with the room is a namesake, stored or fresh", async () => {
  const { sameVenue, sourceOk } = await import("../lib/agent/capacity.ts");
  assert.equal(sameVenue("Bush Hall", "Shepherd's Bush Empire", "music venue in London"), false);
  assert.equal(sameVenue("EartH (Evolutionary Arts Hackney)", "Hackney Empire", "theatre in Hackney, London"), false);
  assert.equal(sameVenue("Islington Assembly Hall", "Islington Assembly Hall", "music venue in London"), true);
  assert.equal(sameVenue("McMenamins Crystal Ballroom", "Crystal Ballroom", "ballroom in Portland, Oregon"), true, "one distinctive word more is the same room");
  // The shared index's first answers, read back: the namesakes are refused (and re-measured), the right item kept.
  assert.equal(sourceOk("Bush Hall", { value: 2000, source: "https://www.wikidata.org/wiki/Q2778511", quote: "Shepherd's Bush Empire: music venue in London; maximum capacity 2,000 (Wikidata P1083)" }), false);
  assert.equal(sourceOk("EartH (Evolutionary Arts Hackney)", { value: 1275, source: "https://www.wikidata.org/wiki/Q5637363", quote: "Hackney Empire: theatre in Hackney, London; maximum capacity 1,275 (Wikidata P1083)" }), false);
  assert.equal(sourceOk("Islington Assembly Hall", { value: 800, source: "https://www.wikidata.org/wiki/Q20711847", quote: "Islington Assembly Hall: music venue in London; maximum capacity 800 (Wikidata P1083)" }), true);
});

test("arenas Qloo also tags as stadiums are rooms for 15,000; a palace in a park is a room", async () => {
  const { isRoom } = await import("../lib/agent/rooms.ts");
  const ids = (s: string) => s.split(", ").map((x) => ({ id: x, name: x.split(":").pop()!.replace(/_/g, " ") }));
  const at = { lat: 36.15, lon: -95.99 };
  // Tags as Qloo's /search returned them (probed Oct 26).
  const bok = { name: "BOK Center", place: at, tags: ids("urn:tag:genre:place:arena, urn:tag:category:place:auditorium, urn:tag:category:place:event_venue, urn:tag:category:place:arena, urn:tag:genre:place:tourist_attraction, urn:tag:category:place:stadium, urn:tag:genre:place:stadium, urn:tag:genre:place:event_venue") };
  const bridgestone = { name: "Bridgestone Arena", place: at, tags: ids("urn:tag:category:place:sports, urn:tag:category:place:event_venue, urn:tag:genre:place:arena, urn:tag:category:place:hockey, urn:tag:genre:place:hockey, urn:tag:genre:place:ice_hockey_rink, urn:tag:genre:place:stadium, urn:tag:category:place:stadium, urn:tag:category:place:arena") };
  const paycom = { name: "Paycom Center", place: at, tags: ids("urn:tag:genre:place:sports_complex, urn:tag:genre:place:concert_hall, urn:tag:category:place:arena, urn:tag:category:place:stadium, urn:tag:genre:place:stadium, urn:tag:genre:place:arena") };
  for (const a of [bok, bridgestone, paycom]) assert.equal(isRoom(a, 15000), true, a.name);
  const ally = { name: "Alexandra Palace", place: at, tags: [...ids("urn:tag:category:place:live_music_venue, urn:tag:genre:place:event_venue, urn:tag:genre:place:ice_skating_rink"), { id: "urn:tag:keyword:place:picnic_areas", name: "Picnic areas" }, { id: "urn:tag:keyword:place:green_spaces", name: "Green spaces" }] };
  assert.equal(isRoom(ally, 3000), true);
  assert.equal(isRoom({ name: "Nissan Stadium", place: at, tags: ids("urn:tag:genre:place:stadium") }, 15000), false, "a stadium that is only a stadium still isn't");
});

test("a city whose Qloo rooms can't take 15,000 gets Wikidata's arena there, found on Qloo first", async () => {
  const tulsa = city("Tulsa", 1), okc = city("Oklahoma City", 2), wichita = city("Wichita", 3);
  const found: string[] = [];
  const deps: PlanDeps = {
    ask: (async () => {
      throw new Error("fixed plan");
    }) as Ask,
    lookUpRooms: async (_a, m) => [{ id: `${m}-club`, name: `${m} Club`, tags: [] }],
    lookUpOpeners: async () => [],
    roomCapacity: async (r) => (r.id.endsWith("-club") ? { value: 400, source: "https://example.org/", quote: "capacity 400" } : null),
    findPlace: async (_a, name) => {
      found.push(name);
      return name === "BOK Center" ? { id: "bok", name: "BOK Center", tags: [], lat: 36.15, lon: -95.99 } : null;
    },
    scoreRooms: async (_a, ids) => new Map(ids.map((x) => [x, 0.9])),
    ladderRooms: async (m) => (m === tulsa.marketId ? [{ qid: "Q4", name: "BOK Center", description: "arena in Tulsa", capacity: 19199 }, { qid: "Q5", name: "Expo Square Pavilion", capacity: 11000 }] : []),
  };
  const lines: Omit<LogLine, "at">[] = [];
  const r = await planTour({ artist, audience, cities: [tulsa, okc, wichita], from: { lat: tulsa.lat, lon: tulsa.lon, label: tulsa.label }, region: "na", shows: 2, draw: 15000, useModel: false, log: (l) => lines.push(l) }, deps);
  const t = r.picks.find((x) => x.marketId === tulsa.marketId)!;
  assert.ok(t, r.picks.map((x) => x.marketId).join(", "));
  const room = t.rooms.find((x) => x.id === t.roomId)!;
  assert.equal(room.id, "bok", "booked with its Qloo id");
  assert.equal(room.origin, "wikidata");
  assert.equal(room.capacity!.value, 19199);
  assert.equal(t.noRoom, undefined);
  assert.ok(found.includes("Expo Square Pavilion"));
  assert.ok(lines.some((l) => !l.failed && l.text === "Wikidata lists Expo Square Pavilion in Tulsa (holds 11,000); Qloo's place search didn't return it there, so it isn't booked."));
});

test("an agent-named room Qloo couldn't be asked about is logged as that, not as 'no such room'", async () => {
  const ask = model((name) => {
    if (name === "shortlist") return { cities: [{ city_id: id("Denver"), why: "strong", rooms: ["Ball Arena"] }, { city_id: id("Salt Lake City"), why: "strong", rooms: [] }, { city_id: id("Albuquerque"), why: "strong", rooms: [] }], alternates: [] };
    return name === "reasons" ? { reasons: [] } : { stops: [stop(id("Denver")), stop(id("Salt Lake City")), stop(id("Albuquerque"))] };
  });
  const deps: PlanDeps = {
    ...tools(ask),
    findPlace: async () => {
      throw new Error("Qloo's rate limit was hit");
    },
  };
  const { p, lines } = run(deps);
  await p;
  assert.ok(lines.some((l) => l.failed && l.text === "Couldn't look up Ball Arena in Denver: Qloo didn't answer."));
  assert.ok(!lines.some((l) => /Ball Arena in Denver; Qloo's place search didn't return it/.test(l.text)));
});

/* ───────────── Ghost's Milan at 8,000: Qloo's list has no one-night fit, so Wikidata's rooms of the right size come in ───────────── */

function milan(ladder: { qid: string; name: string; capacity: number }[]) {
  const mil = city("Milan", 1), tur = city("Turin", 2), bol = city("Bologna", 3);
  const searched: string[] = [];
  const deps: PlanDeps = {
    ask: (async () => {
      throw new Error("fixed plan");
    }) as Ask,
    lookUpRooms: async (_a, m) => (m === mil.marketId ? [{ id: "alcatraz", name: "Alcatraz", tags: [] }] : [{ id: `${m}-arena`, name: `${m} Arena`, tags: [] }]),
    lookUpOpeners: async () => [],
    roomCapacity: async (r) => ({ value: r.id === "alcatraz" ? 3250 : 8000, source: "https://example.org/", quote: "capacity" }),
    findPlace: async (_a, name) => {
      searched.push(name);
      const l = ladder.find((x) => x.name === name);
      return l ? { id: l.qid.toLowerCase(), name: l.name, tags: [], lat: mil.lat, lon: mil.lon } : null;
    },
    scoreRooms: async (_a, ids) => new Map(ids.map((x) => [x, 0.8])),
    ladderRooms: async (m) => (m === mil.marketId ? ladder.map((l) => ({ ...l, description: "arena in Milan" })) : []),
  };
  const lines: Omit<LogLine, "at">[] = [];
  const p = planTour({ artist, audience, cities: [mil, tur, bol], from: { lat: mil.lat, lon: mil.lon, label: mil.label }, region: "eu", shows: 3, draw: 8000, useModel: false, log: (l) => lines.push(l) }, deps);
  return { p, lines, searched, mil };
}

test("Milan at 8,000: the Forum (12,700, a loose fit) beats Alcatraz (3,250, a short room), found on Wikidata then on Qloo", async () => {
  const { p, lines, searched, mil } = milan([{ qid: "Q1", name: "Unipol Forum", capacity: 12700 }]);
  const r = await p;
  const m = r.picks.find((x) => x.marketId === mil.marketId)!;
  const room = m.rooms.find((x) => x.id === m.roomId)!;
  assert.equal(room.name, "Unipol Forum");
  assert.equal(room.origin, "wikidata");
  assert.equal(m.nights, 1);
  assert.deepEqual(searched, ["Unipol Forum"], "the other cities' rooms fit, so no Wikidata lookup there");
  assert.ok(lines.some((l) => /^No room on Qloo's list for Milan fits the crowd for one night/.test(l.text)));
});

test("Milan at 8,000: a room the fans sell out (5,400 = 68%) is looked up first and beats the loose Forum", async () => {
  const { p, searched, mil } = milan([{ qid: "Q1", name: "Unipol Forum", capacity: 12700 }, { qid: "Q2", name: "Allianz Cloud", capacity: 5400 }]);
  const r = await p;
  assert.deepEqual(searched, ["Allianz Cloud", "Unipol Forum"], "in the booker's order, two searches at most");
  const m = r.picks.find((x) => x.marketId === mil.marketId)!;
  assert.equal(m.rooms.find((x) => x.id === m.roomId)!.name, "Allianz Cloud");
});

/* ───────────── Oct 26, second wall pass: European names, ice rinks on the ladder, the hometown against a fan city ───────────── */

test("European room names match after accents, the city's own names and known renames; namesakes still don't", async () => {
  const { roomNameMatches, placeWords } = await import("../lib/agent/plan.ts");
  const milan = placeWords(findMarket("Milan")!), paris = placeWords(findMarket("Paris")!), london = placeWords(findMarket("London")!);
  assert.ok(milan.includes("milano"));
  assert.ok(roomNameMatches("Alcatraz Milano", "Alcatraz", milan), "Alcatraz is on Qloo's Milan list as Alcatraz");
  assert.ok(roomNameMatches("Mediolanum Forum", "Unipol Forum", milan), "renamed: Qloo lists it as the Unipol Forum");
  assert.ok(roomNameMatches("Forum di Milano", "Unipol Forum", milan), "Wikidata's name for it");
  assert.ok(roomNameMatches("Accor Arena Paris", "Accor Arena", paris));
  assert.ok(roomNameMatches("Le Zénith Paris", "Zénith Paris – La Villette", paris));
  assert.ok(!roomNameMatches("Le Zénith Paris", "Le Zénith Sud", paris), "Montpellier's Zénith is another room");
  assert.ok(!roomNameMatches("Accor Arena Paris", "Paris Las Vegas", paris));
  assert.ok(!roomNameMatches("Alcatraz Milano", "Spirit de Milan", milan));
  assert.ok(!roomNameMatches("Bush Hall", "Shepherd's Bush Empire", london));
});

test("a room named as a room keeps its place with a stadium tag (Qloo files the Unipol Forum as a stadium)", async () => {
  const { isRoom } = await import("../lib/agent/rooms.ts");
  const forum = { name: "Unipol Forum", place: { lat: 45.4, lon: 9.14 }, tags: [{ id: "urn:tag:genre:place:stadium", name: "stadium" }, { id: "urn:tag:genre:place:sports_complex", name: "sports complex" }] };
  assert.equal(isRoom(forum, 8000), false, "Qloo's own list still drops a bare stadium");
  assert.equal(isRoom(forum, 8000, { stadiumOk: true }), true);
});

test("the Wikidata ladder drops ice rinks and puts concert rooms first; a list room Wikidata measures is booked without a search", async () => {
  const { roomLadder, ladderTier, concertRoom } = await import("../lib/agent/rooms.ts");
  // Rows as the ladder query returned them for New York (Oct 26): description and instance-of types.
  const rows = [
    { qid: "Q1", name: "Richard J. Codey Arena", description: "ice skating arena in West Orange, New Jersey", capacity: 2500, types: ["arena"] },
    { qid: "Q2", name: "Steinberg Wellness Center", description: "2,500-seat multi-purpose arena", capacity: 2500, types: ["arena"] },
    { qid: "Q3", name: "Terminal 5", description: "music venue in New York City", capacity: 3000, types: ["music venue"] },
    { qid: "Q4", name: "Forum di Milano", description: "indoor sports arena located in Assago, near Milan, Italy", capacity: 15800, types: ["arena"] },
  ];
  const ladder = roomLadder(rows, 2500);
  assert.ok(!ladder.some((l) => l.name === "Richard J. Codey Arena"), "an ice rink is not a rung");
  assert.ok(ladder.some((l) => l.name === "Forum di Milano"), "a sports arena that hosts concerts still is");
  assert.equal(concertRoom(rows[2]!), true);
  assert.equal(concertRoom(rows[3]!), false);

  const nyc = city("New York", 1), phl = city("Philadelphia", 2), bos = city("Boston", 3);
  const searched: string[] = [];
  const deps: PlanDeps = {
    ask: (async () => {
      throw new Error("fixed plan");
    }) as Ask,
    lookUpRooms: async (_a, m) => (m === nyc.marketId ? [{ id: "bowery", name: "The Bowery Ballroom", tags: [] }, { id: "t5", name: "Terminal 5", tags: [] }] : [{ id: `${m}-hall`, name: `${m} Hall`, tags: [], capacity: { value: 2400, source: "https://example.org/", quote: "capacity 2,400" } }]),
    lookUpOpeners: async () => [],
    roomCapacity: async () => null,
    findPlace: async (_a, name) => {
      searched.push(name);
      return null;
    },
    scoreRooms: async () => new Map(),
    ladderRooms: async (m, draw) => (m === nyc.marketId ? ladderTier(roomLadder(rows, draw), draw) : []),
  };
  const r = await planTour({ artist, audience, cities: [nyc, phl, bos], from: { lat: phl.lat, lon: phl.lon, label: phl.label }, region: "na", shows: 3, draw: 2500, useModel: false, log: () => {} }, deps);
  const ny = r.picks.find((x) => x.marketId === nyc.marketId)!;
  assert.equal(ny.roomId, "t5", "Terminal 5, measured by Wikidata, not an ice rink");
  assert.equal(ny.rooms.find((x) => x.id === "t5")!.capacity!.value, 3000);
  assert.ok(!searched.includes("Richard J. Codey Arena"));
});

test("the hometown objection isn't raised against a fan city inside its radius (Baltimore #12 against Philadelphia #1)", () => {
  const phl = city("Philadelphia", 1), bal = city("Baltimore", 12), la = city("Los Angeles", 2);
  const rooms = new Map([phl, la].map((c) => [c.marketId, [{ id: `${c.marketId}-a`, name: "Hall", tags: [] } as Room]]));
  const out = checkPlan([phl, la].map((c) => ({ city_id: c.marketId, room_id: `${c.marketId}-a`, opener_id: "o", why: "" })), { byId: new Map([phl, bal, la].map((c) => [c.marketId, c])), rooms, shows: 2, from: bal, radius: 150, mustKeep: new Set([phl.marketId, la.marketId]) });
  assert.ok(!out.some((o) => o.rule === "home"), out.map((o) => o.text).join(" | "));
});

/* ───────────── the run's time budget (Ghost's European run was stopped at 300 s, Oct 26) ───────────── */

function slowRun(o: { delay: number; until: number; draw: number; names?: (m: string, i: number) => string }) {
  const eight = ["Stockholm", "Oslo", "Copenhagen", "Hamburg", "Berlin", "Amsterdam", "Cologne", "Munich"].map((n, i) => city(n, i + 1));
  let inFlight = 0, most = 0;
  const asked: string[] = [];
  const deps: PlanDeps = {
    ask: (async () => {
      throw new Error("fixed plan");
    }) as Ask,
    lookUpRooms: async (_a, m) => Array.from({ length: 9 }, (_, i): Room => ({ id: `${m}-${i}`, name: o.names?.(m, i) ?? `${m} Theatre ${i}`, tags: [] })),
    lookUpOpeners: async () => [],
    roomCapacity: async (r) => {
      asked.push(r.name);
      most = Math.max(most, ++inFlight);
      await new Promise((ok) => setTimeout(ok, o.delay));
      inFlight--;
      return null;
    },
  };
  const lines: Omit<LogLine, "at">[] = [];
  const st = eight[0]!;
  const p = planTour({ artist, audience, cities: eight, from: { lat: st.lat, lon: st.lon, label: st.label }, region: "eu", shows: 8, draw: o.draw, useModel: false, log: (l) => lines.push(l), lookupsUntil: Date.now() + o.until }, deps);
  return { p, lines, asked, most: () => most };
}

test("40 slow capacity lookups run four at a time a city and stop when the run's time for lookups is up", async () => {
  const t = Date.now();
  const { p, lines, asked, most } = slowRun({ delay: 250, until: 400, draw: 3000 });
  const r = await p;
  const took = Date.now() - t;
  assert.equal(r.picks.length, 8);
  assert.ok(took < 1500, `took ${took} ms for ${asked.length} lookups (serial would be ${asked.length * 250} ms)`);
  assert.ok(most() >= 4, `at most ${most()} lookups at once`);
  // Each city: the first room, then one batch of four before the 400 ms budget runs out; the other 32 never start.
  assert.equal(asked.length, 40, `${asked.length} lookups started of 72 rooms`);
  assert.ok(lines.some((l) => l.failed && /^The run's time for capacity lookups is used up/.test(l.text)));
  assert.equal(lines.filter((l) => /time for capacity lookups is used up/.test(l.text)).length, 1, "said once");
});

test("from 3,000 up, rooms whose name says small (a café, a bar) aren't measured at all", async () => {
  const { p, asked } = slowRun({ delay: 1, until: 60_000, draw: 8000, names: (m, i) => (i < 3 ? ["Marula Café", "The Dive Bar", "Jazz Club"][i]! : `${m} Arena ${i}`) });
  await p;
  assert.ok(asked.length > 0);
  assert.ok(!asked.some((n) => /Café|Bar|Club/.test(n)), asked.join(", "));
});

test("a capacity lookup that never answers is left when the run's time for lookups is up", async () => {
  const eight = ["Stockholm", "Oslo", "Copenhagen", "Hamburg"].map((n, i) => city(n, i + 1));
  const deps: PlanDeps = {
    ask: (async () => {
      throw new Error("fixed plan");
    }) as Ask,
    lookUpRooms: async (_a, m) => [{ id: `${m}-0`, name: `${m} Theatre`, tags: [] }],
    lookUpOpeners: async () => [],
    roomCapacity: () => new Promise(() => {}),
  };
  const t = Date.now();
  const st = eight[0]!;
  const r = await planTour({ artist, audience, cities: eight, from: { lat: st.lat, lon: st.lon, label: st.label }, region: "eu", shows: 4, draw: 3000, useModel: false, log: () => {}, lookupsUntil: Date.now() + 300 }, deps);
  assert.equal(r.picks.length, 4);
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
});

test("check_plan says how to keep a fan city a leg would break: book it and a bridge city in place of the weakest stops", () => {
  const C = ["Denver", "Portland", "Salt Lake City", "Albuquerque", "Omaha", "Wichita"].map((n, i) => city(n, i + 1));
  const byId = new Map(C.map((c) => [c.marketId, c]));
  const rooms = new Map(C.map((c) => [c.marketId, [{ id: `${c.marketId}-a`, name: `${c.name} Hall`, tags: [], capacity: { value: 1500, source: "https://www.wikidata.org/wiki/Q1", quote: "q" } }] as Room[]]));
  const ctx = { byId, rooms, shows: 3, draw: 1500, from: { lat: C[0]!.lat, lon: C[0]!.lon }, radius: 150, mustKeep: new Set([C[1]!.marketId]) };
  // Denver, Omaha, Wichita: Portland (fan #2) can't join without a bridge.
  const o = checkPlan([C[0]!, C[4]!, C[5]!].map((c) => ({ city_id: c.marketId, room_id: `${c.marketId}-a`, opener_id: "op1", why: "x" })), ctx);
  const fan = o.find((x) => x.rule === "fan");
  assert.ok(fan, JSON.stringify(o));
  assert.match(fan!.text, /book Portland \(portland-us-or, room_id portland-us-or-a\) in place of (Wichita|Omaha)/);
});
