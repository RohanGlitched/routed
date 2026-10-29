import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNumbers, checkWhy, roomClause, whyProblems, evidenceLines, recheckPitch, showNights } from "../lib/agent/evidence.ts";
import { recheckTour } from "../lib/agent/recheck.ts";
import { readLine } from "../lib/log.ts";
import type { Plan, Stop, TourRecord } from "../lib/types.ts";

/* The flagship tour (Sierra Ferrell, bnwvpmjuet), trimmed to what the Lexington stop's evidence reads. */
const room = {
  id: "lyric",
  name: "Lyric Theatre & Cultural Arts Center",
  address: "300 E Third St Lexington, KY 40508",
  // 3.3 km east of the hottest tile, as the stored tour has it.
  lat: 38.0594,
  lon: -84.4857,
  affinity: 0.8363892052934128,
  popularity: 0.8783565326858094,
  capacity: { value: 600, source: "https://www.cvent.com/venues/lexington/entertainment-venue/lyric-theatre-cultural-art-center" },
  tags: [],
};
const support = { id: "waldon", name: "Kelsey Waldon", affinity: 0.9787864047173177, genres: ["alt country", "americana"], shared: ["Blues", "Soulful", "Red Dirt"] };
const lexington = {
  marketId: "lexington-us-ky",
  city: "Lexington",
  label: "Lexington, KY",
  lat: 37.9887,
  lon: -84.4777,
  date: "2027-05-07",
  nights: 2,
  score: { marketId: "lexington-us-ky", name: "Lexington", label: "Lexington, KY", lat: 37.9887, lon: -84.4777, affinity: 0.988, popularity: 0.989, tiles: 18, rank: 9 },
  rooms: [room],
  roomId: "lyric",
  openers: [support],
  openerId: "waldon",
  local: { tiles: [[38.0594, -84.5233, 1], [38.0601, -84.524, 0.8]], hot: { lat: 38.0594, lon: -84.5233, trait: "Accessible" }, roomKm: 3.3, inHot: false },
  after: [{ id: "a", name: "The Green Lantern" }, { id: "b", name: "The Fishtank" }],
  why: "Lexington is Sierra Ferrell's #9 city on Qloo, and Lyric Theatre & Cultural Arts Center holds 600 a night over two nights.",
} as unknown as Stop;
const plan = {
  artist: { id: "sierra", name: "Sierra Ferrell", genres: ["Alt Country", "Country", "Usa"] },
  cities: Array.from({ length: 407 }, (_, i) => ({ rank: i + 1 })),
  audience: {
    age: { "24_and_younger": -0.29, "25_to_29": -0.2, "30_to_34": 0.61, "35_to_44": 0.08, "45_to_54": -0.5, "55_and_older": -0.56 },
    taste: {
      music: [{ name: "americana" }, { name: "roots rock" }, { name: "country" }, { name: "Alt- country" }],
      vibe: [{ name: "Storyteller" }, { name: "Authentic" }, { name: "Evocative" }],
    },
    tags: [],
    trend: [],
  },
  stops: [lexington],
} as unknown as Plan;

/* The hold request Nemotron wrote for Lexington, as stored before the fix (the second night was struck). */
const storedLexington = {
  subject: "Hold request — Sierra Ferrell — Friday, May 7 & Saturday, May ~~8~~ — Lyric Theatre, Lexington",
  body: "Hi,\n\nI’d like to hold Friday, May 7 and Saturday, May ~~8~~ for Sierra Ferrell at the Lyric Theatre & Cultural Arts Center in Lexington. Lexington ranks 9th of 407 cities in the region for fan affinity with a 99 score, and the venue scores 84 with her audience. At 600 capacity the room is small for the usual crowd of about 1,500, so two nights are needed; the venue sits 3.3 km from the strongest fan neighbourhood. Kelsey Waldon opens the run; her audience shares a 98 affinity with Sierra’s and overlaps on blues, soulful and red‑dirt tastes. Sierra’s fans over‑index at ages 30–34 and describe the sound as storyteller, authentic and evocative.\n\nThanks,",
  struck: ["8", "8"],
};

test("a two-night stand's evidence names both nights, so the Lexington pitch's “May 8” is not struck", () => {
  assert.deepEqual(showNights(lexington), ["2027-05-07", "2027-05-08"]);
  const ev = evidenceLines(plan, lexington, 1500);
  assert.ok(ev.some((l) => l.includes("Friday, May 7 (2027-05-07) and Saturday, May 8 (2027-05-08)")), ev[1]);
  const plain = (t: string) => t.replace(/~~/g, "");
  assert.deepEqual(checkNumbers(plain(storedLexington.body), ev).struck, []);
  assert.deepEqual(checkNumbers(plain(storedLexington.subject), ev).struck, []);
  // The stored pitch, checked again: the strikes come off and nothing else is struck.
  const again = recheckPitch(storedLexington, ev);
  assert.deepEqual(again.struck, []);
  assert.ok(again.subject.endsWith("Saturday, May 8 — Lyric Theatre, Lexington"));
  assert.ok(!again.body.includes("~~"));
});

test("a one-night stop still strikes the next day, and a figure that isn't in the evidence stays struck", () => {
  const one = { ...lexington, nights: undefined } as Stop;
  const ev = evidenceLines(plan, one, 1500);
  assert.deepEqual(checkNumbers("Friday, May 7 and Saturday, May 8", ev).struck, ["8"]);
  assert.deepEqual(checkNumbers("We sold 2,000 tickets last time.", evidenceLines(plan, lexington, 1500)).struck, ["2,000"]);
});

test("the checker is idempotent, reads “15k” as 15,000 and leaves a date's comma outside the strike", () => {
  const ev = ["Usual crowd: about 15000.", "Date asked for: Sunday, May 9 (2027-05-09)"];
  const once = checkNumbers("A room for 15k on May 9, 2027, after 77 shows.", ev);
  assert.deepEqual(once.struck, ["77"]);
  assert.equal(once.text, "A room for 15k on May 9, 2027, after ~~77~~ shows.");
  const twice = checkNumbers(once.text, ev);
  assert.equal(twice.text, once.text);
  assert.equal(checkNumbers("holds ~~~~1,765~~~~.", ["capacity 1765"]).text, "holds 1,765.");
  assert.deepEqual(checkNumbers("about 3km away", ["3000 people"]).struck, ["3"]);
});

test("a stop's reason may cite what the booking model saw (room popularity), and a rule's sentence is rebuilt from the room as measured", () => {
  const keep = { keepModel: true };
  const s = { ...lexington, why: "Lexington ranks #9 and the Lyric scores 88 popularity with 84 affinity." } as Stop;
  assert.equal(checkWhy(plan, s, 1500, keep), s.why);
  const stale = { ...lexington, why: "Lexington is Sierra Ferrell's #9 city on Qloo, and Lyric Theatre & Cultural Arts Center holds ~~1,200~~ a night over two nights." } as Stop;
  assert.equal(checkWhy(plan, stale, 1500, keep), "Lexington is Sierra Ferrell's #9 city on Qloo, and Lyric Theatre & Cultural Arts Center holds 600 a night over two nights.");
  // A figure the evidence doesn't hold: the rule's sentence replaces the line, never a struck number on the page.
  const wrong = { ...lexington, why: "Lexington ranks #19 for these fans." } as Stop;
  assert.equal(checkWhy(plan, wrong, 1500, keep), "Lexington is Sierra Ferrell's #9 city on Qloo, and Lyric Theatre & Cultural Arts Center holds 600 a night over two nights.");
});

test("a model's 'why' with prompt jargon, a false 'fits' or a score written as a rank gives way to the rule's sentence", () => {
  const keep = { keepModel: true };
  const one = { ...lexington, nights: 1 } as Stop;
  const rule = "Lexington is Sierra Ferrell's #9 city on Qloo, and Lyric Theatre & Cultural Arts Center holds 600 of a usual crowd of 1,500: it takes 3 nights to hold the crowd, so ask for 3 nights or a bigger room.";
  for (const why of ["Lexington ranks #9 and the Lyric is the rule_pick room.", "Lexington ranks #9, marked named_by_you.", "Lexington ranks #9 and the Lyric fits the 1,500 crowd at 600 capacity.", "Lexington ranks #9; Kelsey Waldon ranked 98 for Sierra Ferrell's audience."]) {
    assert.deepEqual(checkWhy(plan, { ...one, why } as Stop, 1500, keep), rule, why);
  }
  assert.ok(whyProblems(plan, { ...one, why: "Lexington ranks #9 and the Lyric fits the crowd." } as Stop, 1500).includes("'fits' outside 85-130% of the crowd"));
});

test("the rule's sentence says 'fits' only at 85-130% and names the next step for a room the fans sell out", () => {
  const r = (value: number, source = "https://www.wikidata.org/wiki/Q1") => ({ id: `r${value}`, name: `Room ${value}`, tags: [], capacity: { value, source, quote: "q" } });
  assert.equal(roomClause(r(1600), 1500, 1), "Room 1600 fits the usual crowd of 1,500 at 1,600");
  assert.equal(roomClause(r(1050), 1500, 1, [r(1050), r(2000)]), "Room 1050 holds 1,050 of a usual crowd of 1,500: the fans should sell it out, so ask about a second night or Room 2000 (2,000)");
  assert.equal(roomClause(r(1050), 1500, 1, [r(2000, "https://www.eventticketscenter.com/x")]), "Room 1050 holds 1,050 of a usual crowd of 1,500: the fans should sell it out, so ask about a second night");
  assert.equal(roomClause(r(3000), 1500, 1), "Room 3000 holds 3,000 against a usual crowd of 1,500");
});

test("every stop's reason is the rule's sentence by default, and a broken model line never survives", () => {
  const rule = "Lexington is Sierra Ferrell's #9 city on Qloo, and Lyric Theatre & Cultural Arts Center holds 600 a night over two nights.";
  const model = { ...lexington, why: "Lexington ranks #9 and the Lyric scores 88 popularity with 84 affinity." } as Stop;
  assert.equal(checkWhy(plan, model, 1500), rule, "one voice on every stop");
  const broken = { ...lexington, why: "Lexington ranks #9 heatmap and the Lyric is a room the Lyric is a room for fans." } as Stop;
  assert.equal(checkWhy(plan, broken, 1500, { keepModel: true }), rule, "a repeated run of words: the rule's sentence instead");
  const bare = { ...lexington, rooms: [{ ...room, capacity: undefined, affinity: undefined }], why: "x" } as unknown as Stop;
  assert.equal(checkWhy(plan, bare, 1500), "Lexington is Sierra Ferrell's #9 city on Qloo, and Lyric Theatre & Cultural Arts Center is a room these fans go to.", "no capacity or score: no 'matches these fans at 0'");
});

test("re-checking a stored tour lifts the false strikes, logs one line, and a second pass changes nothing", () => {
  const rec = { id: "bnwvpmjuet", createdAt: "2026-10-15T00:00:00Z", status: "done", input: { artist: "Sierra Ferrell", from: "Nashville, TN", firstDate: "2027-05-06", shows: 8, draw: 1500 }, log: [], plan: { ...plan, stops: [{ ...lexington, pitch: storedLexington }] } } as unknown as TourRecord;
  const first = recheckTour(rec, "2026-10-15T12:00:00Z");
  assert.equal(first.before, 2);
  assert.equal(first.after, 0);
  assert.deepEqual(first.changed, ["Lexington"]);
  assert.equal(first.rec.log.length, 1);
  assert.deepEqual(first.rec.plan!.stops[0]!.pitch!.struck, []);
  assert.deepEqual(rec.plan!.stops[0]!.pitch!.struck, ["8", "8"], "the stored record isn't mutated");
  const second = recheckTour(first.rec);
  assert.deepEqual(second.changed, []);
  assert.equal(second.rec, first.rec);
});

test("stored call sheets read the one-support-act rule: the old booking line is reworded", () => {
  const old = { at: "x", kind: "model" as const, text: "Booked 8 stops: a room and an opener in each.", result: "Nashville, Lexington" };
  assert.equal(readLine(old).text, "Booked 8 stops: a room in each, and one support act for the run.");
  assert.equal(readLine(old).result, old.result);
  const other = { at: "x", kind: "qloo" as const, text: "Who could open in Lexington, for an audience like Sierra Ferrell's?" };
  assert.equal(readLine(other), other);
});
