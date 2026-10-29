import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNumbers, evidenceLines, falseLocalClaim, fullDate, garbled, routingWords, signed, stopLocal, templatePitch } from "../lib/agent/evidence.ts";
import { recheckTour } from "../lib/agent/recheck.ts";
import type { Plan, Stop, TourRecord } from "../lib/types.ts";

/* The Oct 25 panel's pitch findings (M3): no year, no hold rank, no routing, Qloo jargon ("shares a 98 affinity"),
   off-genre "shared tastes", and one garbled sentence that the number check let through. */

const lyric = { id: "lyric", name: "Lyric Theatre & Cultural Arts Center", affinity: 0.84, tags: [], capacity: { value: 600, source: "https://example.com/lyric", quote: "q" } };
const waldon = { id: "waldon", name: "Kelsey Waldon", affinity: 0.9787, genres: ["alt country", "americana"], shared: ["Blues", "Soulful", "Red Dirt"] };
const stop = (city: string, date: string, rank: number, extra: Partial<Stop> = {}) =>
  ({ marketId: city.toLowerCase(), city, label: `${city}, XX`, lat: 0, lon: 0, date, fromKm: 0, fromHours: 0, travelDays: 0, dayOff: false, score: { rank, affinity: 0.99 }, rooms: [lyric], roomId: "lyric", openers: [waldon], openerId: "waldon", after: [], ...extra }) as unknown as Stop;
const knoxville = stop("Knoxville", "2027-05-05", 8);
const lexington = stop("Lexington", "2027-05-07", 9, { nights: 2 });
const santaFe = stop("Santa Fe", "2027-05-14", 6, { rooms: [{ ...lyric, id: "lensic", name: "Lensic Performing Arts Center", capacity: { value: 821, source: "s", quote: "q" } }], roomId: "lensic" });
const plan = {
  artist: { id: "sierra", name: "Sierra Ferrell", genres: ["Alt Country", "Country", "Usa"], genreKeys: ["alt country", "country", "americana"] },
  cities: Array.from({ length: 407 }, (_, i) => ({ rank: i + 1 })),
  audience: { age: { "30_to_34": 0.61 }, tags: [], trend: [] },
  stops: [knoxville, lexington, santaFe],
} as unknown as Plan;

test("the template asks for a dated 1st hold with the year, gives the routing in and out, and signs when asked", () => {
  const p = templatePitch(plan, lexington, { draw: 1500, sign: "Rohan, Routed Booking" });
  assert.equal(p.subject, "Hold request: Sierra Ferrell, Lexington, Friday, May 7 and Saturday, May 8, 2027");
  assert.match(p.body, /a 1st hold for Sierra Ferrell on Friday, May 7 and Saturday, May 8, 2027 at Lyric Theatre/);
  assert.match(p.body, /a 2nd hold works/);
  assert.match(p.body, /Routing: in from Knoxville \(Wednesday, May 5\), out to Santa Fe \(Friday, May 14\)\./);
  assert.match(p.body, /both nights together hold 1,200 of that/, "two nights short of the crowd say so");
  assert.match(p.body, /Qloo ranks it #9 of 407 cities in the region for Sierra Ferrell fans\./, "one plain line of Qloo evidence");
  assert.ok(p.body.endsWith("Thanks,\nRohan, Routed Booking"));
  assert.ok(!/affinity|over-index|shares? a/i.test(p.body), "no Qloo jargon, no ages as fact");
  assert.ok(!/blues|soulful|red dirt/i.test(p.body), "no tastes the two acts aren't both filed under");
  assert.ok(templatePitch(plan, lexington).body.endsWith("Thanks,"), "no signature: nothing after Thanks,");
  assert.equal(routingWords(plan, knoxville), "the opening night of the run, out to Lexington (Friday, May 7)");
  assert.equal(routingWords(plan, santaFe), "in from Lexington (Saturday, May 8), the last night of the run");
  assert.equal(fullDate("2027-03-12"), "Friday, March 12, 2027");
});

test("the template says 'fits' only at 85–130% of the crowd", () => {
  const at = (cap: number, nights?: number) => templatePitch(plan, { ...knoxville, nights, rooms: [{ ...lyric, capacity: { value: cap, source: "s", quote: "q" } }] } as Stop, { draw: 1500 }).body;
  assert.match(at(1400), /The room's 1,400 fits our usual crowd of about 1,500\./);
  assert.match(at(1270), /The room holds 1,270 of our usual crowd of about 1,500\./);
  assert.match(at(3000), /The room holds 3,000 against our usual crowd of about 1,500\./);
  assert.match(at(460), /second night or a larger room/);
  assert.match(at(5000), /reduced configuration/);
  assert.match(at(821, 2), /both nights \(1,642 across the two\)/);
  for (const cap of [400, 900, 1270, 1300, 1950, 2000, 3000, 5000]) assert.equal(/\bfits\b/.test(at(cap)), cap >= 1275 && cap <= 1950, `${cap}`);
});

test("every figure in the template is in the stop's evidence, so re-checking it strikes nothing", () => {
  for (const s of plan.stops) {
    for (const draw of [undefined, 900, 1500, 5000]) {
      const p = templatePitch(plan, s, { draw });
      const ev = evidenceLines(plan, s, draw);
      assert.deepEqual(checkNumbers(p.subject, ev).struck, [], `${s.city} ${draw} subject`);
      assert.deepEqual(checkNumbers(p.body, ev).struck, [], `${s.city} ${draw} body`);
      assert.deepEqual(garbled(`${p.subject}\n${p.body}`), [], `${s.city} ${draw} reads clean`);
    }
  }
});

test("the evidence calls the support act's score a rank for the headliner's audience, and keeps only genres both acts carry", () => {
  const ev = evidenceLines(plan, lexington, 1500).join("\n");
  assert.match(ev, /Qloo scores Kelsey Waldon 98 out of 100 as a match for Sierra Ferrell's audience/);
  assert.match(ev, /write "a 98\/100 audience match on Qloo", never "ranked 98"/);
  assert.match(ev, /never "shares an affinity"/);
  assert.doesNotMatch(ev, /Blues|Soulful|Red Dirt/);
  assert.match(ev, /1st hold/);
  assert.match(ev, /Routing: in from Knoxville/);
  assert.match(ev, /two nights hold 1200, still short of it/);
  const shared = { ...waldon, shared: ["Alt Country", "Blues"] };
  const both = evidenceLines(plan, { ...lexington, openers: [shared] } as Stop, 1500).join("\n");
  assert.match(both, /both acts are filed under Alt Country\./);
  assert.match(templatePitch(plan, { ...lexington, openers: [shared] } as Stop).body, /Kelsey Waldon supports on every date; both acts are filed under alt country\./);
});

test("a garbled sentence is caught next to the number check", () => {
  const sf = "San Francisco leads the region at #1 of 409 cities with a 100 fan-a cities with a 100 affinity score, and the Fillmore suits the bill.";
  const g = garbled(sf);
  assert.ok(g.some((x) => x.startsWith("repeated")), g.join("; "));
  assert.ok(g.some((x) => x.includes('"fan-a"')), g.join("; "));
  assert.deepEqual(checkNumbers(sf, ["#1 of 409 cities, 100"]).struck, [], "the number check alone lets it through");
  assert.deepEqual(garbled("Duran Duran and Talk Talk play an e-mail-free, all-ages show at the 9:30 Club."), [], "names and real hyphens are fine");
  assert.ok(garbled("We would love the the date.").length);
  assert.ok(garbled("Hi [Name], could we hold May 7?").length);
  assert.ok(garbled("Lexington ranks 9th ,, and the room holds 600.").length);
  assert.deepEqual(garbled("Could we place a 1st hold on Friday, May 7, 2027? The room holds 600 against a usual crowd of 1,500."), []);
});

test("re-checking a stored tour re-drafts a garbled hold request from the template, with no model call", () => {
  const bad = { subject: "Hold request: Sierra Ferrell, Friday, May 14", body: "Hi,\n\nSanta Fe leads at #6 of 407 cities with a 99 fan-a cities with a 99 affinity score.\n\nThanks,", struck: [] };
  const rec = { id: "t", createdAt: "x", status: "done", input: { artist: "Sierra Ferrell", from: "Nashville, TN", firstDate: "2027-05-05", shows: 3, draw: 1500 }, log: [], plan: { ...plan, stops: [knoxville, lexington, { ...santaFe, pitch: bad }] } } as unknown as TourRecord;
  const r = recheckTour(rec, "2026-10-25T00:00:00Z");
  assert.deepEqual(r.redrafted, ["Santa Fe"]);
  const p = r.rec.plan!.stops[2]!.pitch!;
  assert.match(p.subject, /2027$/);
  assert.match(p.body, /1st hold/);
  assert.deepEqual(garbled(p.body), []);
  assert.match(r.rec.log.at(-1)!.result!, /re-drafted Santa Fe/);
  assert.equal(recheckTour(r.rec).rec, r.rec, "a second pass changes nothing");
});

test("a signature goes under Thanks, once", () => {
  assert.equal(signed("Hi,\n\nBody.\n\nThanks,", "Rohan"), "Hi,\n\nBody.\n\nThanks,\nRohan");
  assert.equal(signed("Hi,\n\nBody.\n\nThanks,\nRohan", "Rohan"), "Hi,\n\nBody.\n\nThanks,\nRohan");
  assert.equal(signed("Hi,\n\nBody.", "Rohan"), "Hi,\n\nBody.\n\nThanks,\nRohan");
  assert.equal(signed("Hi,\n\nThanks,", "  "), "Hi,\n\nThanks,");
});

/* The street level (H4 wiring, Oct 25): the evidence reads geo/local.ts readLocal, so "sits in" needs Qloo to file the
   room under the fans' own neighbourhood; a stored pitch that claimed it by distance is re-drafted. */
const tiles: [number, number, number][] = [[45.5122, -122.6587, 1], [45.513, -122.659, 0.9]];
const near = { ...lyric, id: "dantes", name: "Dante's", lat: 45.5232, lon: -122.6587, area: "Old Town" };
const portland = stop("Portland", "2027-05-10", 3, { rooms: [near], roomId: "dantes", local: { tiles, hot: { lat: 45.5122, lon: -122.6587, name: "Buckman", trait: "Creative hub", named: "near" } } as unknown as Stop["local"] });
const inside = stop("Portland", "2027-05-10", 3, { rooms: [{ ...near, area: "Buckman", lat: 45.5125, lon: -122.6588 }], roomId: "dantes", local: portland.local });
const p2 = { ...plan, stops: [portland] } as unknown as Plan;

test("the evidence says 'sits in' only when Qloo files the room under the fans' neighbourhood", () => {
  const ev = evidenceLines(p2, portland, 1500).join("\n");
  assert.match(ev, /strongest area in Portland around Buckman, creative hub; Dante's is 1\.2 km from those blocks\. Qloo files Dante's under Old Town\. Do not write that Dante's is in Buckman\./);
  assert.doesNotMatch(ev, /one neighbourhood|sits in it/);
  assert.match(evidenceLines({ ...plan, stops: [inside] } as unknown as Plan, inside, 1500).join("\n"), /Dante's sits in Buckman/);
});

test("a false neighbourhood claim is caught, and re-checking re-drafts the stored pitch", () => {
  const read = stopLocal(portland);
  assert.equal(falseLocalClaim("Dante's sits in it, right where her fans are.", read), true);
  assert.equal(falseLocalClaim("Dante's is in Buckman, the fans' strongest area.", read), true);
  assert.equal(falseLocalClaim("Fans cluster around Buckman; Dante's is 1.2 km away.", read), false, "saying where the fans are is fine");
  assert.equal(falseLocalClaim("Dante's sits in it.", stopLocal(inside)), false, "true when Qloo files it there");
  assert.equal(falseLocalClaim("The heatmap puts fans in one neighbourhood.", undefined), true, "the old placeholder");
  const bad = { subject: "Hold request: Sierra Ferrell, Monday, May 10", body: "Hi,\n\nDante's sits in the fans' strongest area, 1.2 km from it.\n\nThanks,", struck: [] };
  const rec = { id: "t", createdAt: "x", status: "done", input: { artist: "Sierra Ferrell", from: "Nashville, TN", firstDate: "2027-05-10", shows: 1, draw: 1500 }, log: [], plan: { ...p2, stops: [{ ...portland, pitch: bad }] } } as unknown as TourRecord;
  const r = recheckTour(rec, "2026-10-25T00:00:00Z");
  assert.deepEqual(r.redrafted, ["Portland"]);
  assert.doesNotMatch(r.rec.plan!.stops[0]!.pitch!.body, /sits in/);
  assert.match(r.rec.log.at(-1)!.text, /neighbourhood Qloo doesn't file it under/);
});
