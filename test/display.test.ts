import { test } from "node:test";
import assert from "node:assert/strict";
import { capacityCeiling, checkLine, mapName, otherRoomLabel, placeLabels, sheetCounts, shownCapacity, stopAnchor, stripLabel } from "../components/tour/display.ts";
import type { LogLine } from "../lib/types.ts";

const cap = (value: number) => ({ value, source: "https://example.org", quote: "" });

test("the stop strip names a stop as the poster dates it, and anchors count from 1", () => {
  assert.equal(stripLabel({ date: "2027-05-06", city: "Nashville" }), "5/6 Nashville");
  assert.equal(stripLabel({ date: "2027-11-18", city: "Seattle" }), "11/18 Seattle");
  assert.equal(stopAnchor(0), "stop-1");
  assert.equal(stopAnchor(7), "stop-8");
});

test("a capacity impossible for the kind of room is not printed", () => {
  assert.equal(shownCapacity({ name: "Madison Theater", capacity: cap(17_556) }), undefined);
  assert.equal(shownCapacity({ name: "The East Room", capacity: cap(9_000) }), undefined);
  assert.deepEqual(shownCapacity({ name: "Taft Theatre", capacity: cap(2_500) }), cap(2_500));
  // Amphitheatres, arenas and centres are built for big crowds, whatever else their name says.
  assert.deepEqual(shownCapacity({ name: "Utah First Credit Union Amphitheatre", capacity: cap(20_000) }), cap(20_000));
  assert.deepEqual(shownCapacity({ name: "Madison Square Garden", capacity: cap(19_500) }), cap(19_500));
  assert.deepEqual(shownCapacity({ name: "Bogart's", capacity: cap(1_200) }), cap(1_200));
  assert.equal(shownCapacity({ name: "Bogart's" }), undefined);
  assert.equal(capacityCeiling("Ryman Auditorium"), 10_000);
  assert.equal(capacityCeiling("Clubhouse on South Temple"), undefined);
});

test("every aside on another room says what its number is", () => {
  assert.equal(otherRoomLabel({ name: "Bogart's", capacity: cap(1_200), affinity: 0.86 }), "Bogart's (holds 1,200)");
  assert.equal(otherRoomLabel({ name: "Musicians Corner", affinity: 0.92 }), "Musicians Corner (fan affinity 92)");
  assert.equal(otherRoomLabel({ name: "Madison Theater", capacity: cap(17_556), affinity: 0.88 }), "Madison Theater (fan affinity 88)");
  assert.equal(otherRoomLabel({ name: "The Vera Project" }), "The Vera Project");
});

test("the call sheet counts lines by kind, and the Qloo lines that carry a request", () => {
  const at = "2026-10-25T00:00:00Z";
  const log: LogLine[] = [
    { at, kind: "qloo", text: "Who is X on Qloo?", request: "/search?query=X" },
    { at, kind: "qloo", text: "Looked up the rooms the agent named on Qloo, in their cities." },
    { at, kind: "qloo", text: "Is this audience growing?", request: "/v2/trending" },
    { at, kind: "model", text: "Asked the model alone." },
    { at, kind: "rule", text: "Routed the dates." },
    { at, kind: "web", text: "How many does Y hold?" },
  ];
  assert.deepEqual(sheetCounts(log), { qloo: 2, withRequest: 1, model: 1, rule: 1, web: 1 });
});

test("the agent check reads as one sentence", () => {
  assert.equal(
    checkLine({ before: 3, after: 3, rounds: 2, revised: 4, ruled: 3, stops: 8 } as never),
    "The rules raised 3 objections to the agent's booking; it re-booked 4 picks in 2 rounds, leaving 3 objections. A rule still changed 3 of 8 stops.",
  );
  assert.equal(checkLine({ before: 0, after: 0, rounds: 0, revised: 0, ruled: 0, stops: 8 } as never), "The agent's booking cleared every rule. Every stop is the agent's own.");
});

test("map labels stay inside the square and clear of each other", () => {
  const size = 260;
  const ls = placeLabels(
    [
      { text: "The Orange Peel", x: 130, y: 130 },
      { text: "Downtown", x: 132, y: 131 },
      { text: "Voltage Records", x: 250, y: 60 },
      { text: "A very long place name that cannot fit anywhere at all on this map", x: 130, y: 130 },
    ],
    size,
  );
  const boxes = ls.filter((l): l is NonNullable<typeof l> => !!l).map((l) => l.box);
  for (const b of boxes) assert.ok(b[0] >= 2 && b[1] >= 2 && b[2] <= size - 2 && b[3] <= size - 2, JSON.stringify(b));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i]!, boxes[j]!];
      assert.ok(!(a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]), `labels ${i} and ${j} overlap`);
    }
  assert.equal(ls[0]!.anchor, "start");
  assert.equal(ls[2]!.anchor, "end", "a label at the right edge goes left of its point");
  assert.equal(ls[3], null, "a label that fits nowhere is left out");
});

test("map names are cut at a word", () => {
  assert.equal(mapName("The Orange Peel"), "The Orange Peel");
  assert.equal(mapName("Snooze, an A.M. Eatery"), "Snooze");
  assert.equal(mapName("University of Cincinnati College-Conservatory of Music (CCM)", 24), "University of Cincinnati…");
});
