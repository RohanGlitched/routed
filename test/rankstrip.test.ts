import { test } from "node:test";
import assert from "node:assert/strict";
import { DOT_R, layoutStrip, rankX, stack } from "../lib/rankstrip.ts";

// The Sierra Ferrell flagship (bnwvpmjuet): Routed's cities #2 to #12, the model alone's out to #202.
const ours = [["Nashville", 2], ["Lexington", 9], ["Knoxville", 8], ["Austin", 5], ["Santa Fe", 6], ["Denver", 4], ["Bend", 12], ["Portland", 3]].map(([name, rank]) => ({ name: name as string, rank: rank as number }));
const theirs = [["Nashville", 2], ["Atlanta", 90], ["Chicago", 50], ["Denver", 4], ["Seattle", 16], ["San Francisco", 29], ["Dallas", 89], ["Toronto", 202]].map(([name, rank]) => ({ name: name as string, rank: rank as number }));

test("the axis is logarithmic: #1 to #10 takes as much room as #10 to #100", () => {
  const a = rankX(1, 100, 0, 600), b = rankX(10, 100, 0, 600), c = rankX(100, 100, 0, 600);
  assert.ok(Math.abs(b - a - (c - b)) < 1e-9);
});

test("tick labels sit under their own baseline, below every dot", () => {
  const st = layoutStrip(ours, theirs, 407);
  const lowest = Math.max(...st.rows.flatMap((r) => r.dots.map((d) => d.y + DOT_R)));
  assert.ok(lowest < st.axis.y, "a dot reaches the axis");
  for (const r of st.rows) for (const d of r.dots) if (d.label) assert.ok(d.label.y < st.axis.y - 6, `${d.name}'s label is on the axis`);
  assert.equal(st.ticks.at(-1)!.label, "#407");
  assert.ok(st.ticks.some((t) => t.label === "#1"));
});

test("Routed's strong cities spread out instead of piling up, and dots in a row never touch", () => {
  const st = layoutStrip(ours, theirs, 407);
  const xs = st.rows[0]!.dots.map((d) => d.x).sort((a, b) => a - b);
  assert.ok(xs.at(-1)! - xs[0]! > 0.25 * (st.axis.x2 - st.axis.x1), "the #2 to #12 cluster spans under a quarter of the axis (it took 3% on a linear one)");
  for (const r of st.rows)
    for (const a of r.dots) for (const b of r.dots) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 2 * DOT_R, `${a.name} touches ${b.name}`);
  // The model's weakest pick is named.
  assert.ok(st.rows[1]!.dots.find((d) => d.name === "Toronto")!.label);
});

test("labels in a row never overlap", () => {
  const st = layoutStrip(ours, theirs, 407);
  for (const r of st.rows) {
    const set = r.dots.filter((d) => d.label).map((d) => d.label!);
    for (const a of set) for (const b of set) if (a !== b && a.y === b.y) assert.ok(Math.abs(a.x - b.x) > 6.6 * (a.text.length + b.text.length) / 2, `${a.text} / ${b.text}`);
  }
});

test("a city off the fan map gets its own slot past the axis", () => {
  const st = layoutStrip(ours, [...theirs.slice(0, 7), { name: "Toronto" }], 407);
  assert.ok(st.off);
  const t = st.rows[1]!.dots.find((d) => d.name === "Toronto")!;
  assert.ok(t.x > st.axis.x2 + 20);
});

test("stacking takes the nearest free level", () => {
  assert.deepEqual(stack([10, 100, 200]), [0, 0, 0]);
  const dy = stack([10, 12, 14]);
  assert.equal(new Set(dy).size, 3);
});
