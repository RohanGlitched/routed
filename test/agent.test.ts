import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan, planTour, type Ask, type BookStop, type PlanDeps } from "../lib/agent/plan.ts";
import { findMarket, marketId, marketLabel } from "../lib/geo/markets.ts";
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
  assert.deepEqual(r.check, { before: 1, after: 0, rounds: 1, revised: 1, ruled: 0, stops: 3 });
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
  assert.deepEqual(calls, ["shortlist", "book", "rebook", "rebook"], "at most two revision rounds, and no call left for reasons");
  assert.equal(r.check!.rounds, 2);
  assert.equal(r.check!.before, 1, "the invented city (the stop it leaves short isn't counted twice)");
  assert.equal(r.check!.after, 1);
  assert.equal(r.check!.ruled, 1, "the rules filled one stop");
  assert.ok(lines.some((l) => /The agent booked 2 usable stops; the ranking filled the other 1\./.test(l.text)));
  // The filled stop gets the rule's sentence, built from evidence only.
  const filled = r.picks.find((x) => ![id("Denver"), id("Salt Lake City")].includes(x.marketId))!;
  assert.match(filled.why!, /^.+ is Test Artist's #\d+ city on Qloo, and .+ matches these fans at \d+\.$/);
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
  assert.deepEqual(r.check, { before: 0, after: 0, rounds: 0, revised: 0, ruled: 1, stops: 3 });
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
  assert.deepEqual(r.check, { before: 1, after: 0, rounds: 1, revised: 1, ruled: 0, stops: 3 });
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
  assert.match(out.find((o) => o.rule === "room")!.text, /the room rule would book Big Hall \(s-big\), which holds 1,500 \(fits for about 1,200\)/);
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
  assert.match(out[0]!.text, /Wexner Center for the Arts has no confirmed capacity; the room rule would book KEMBA Live! \(kemba\), which holds 2,200 \(fits for about 1,500\)/);
});
