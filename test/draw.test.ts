import { test } from "node:test";
import assert from "node:assert/strict";
import { assumeDraw, CROWD_OPTIONS } from "../lib/draw.ts";

test("an assumed crowd comes from Qloo popularity and lands on a dropdown option", () => {
  assert.equal(assumeDraw(undefined), undefined);
  assert.equal(assumeDraw(Number.NaN), undefined);
  assert.equal(assumeDraw(0.955), 1000); // Wednesday
  assert.equal(assumeDraw(0.97), 1500); // Black Pumas
  assert.equal(assumeDraw(0.9889), 2500); // Fontaines D.C.
  assert.equal(assumeDraw(0.9949), 4000); // Ghost
  assert.equal(assumeDraw(0.9995), 12000);
  assert.equal(assumeDraw(0.4), 150);
  for (const p of [0, 0.5, 0.85, 0.92, 0.96, 0.975, 0.99, 0.995, 0.998, 1]) assert.ok((CROWD_OPTIONS as readonly number[]).includes(assumeDraw(p)!), `option for ${p}`);
});

test("the bands never go down as popularity goes up", () => {
  let last = 0;
  for (let p = 0; p <= 1.0001; p += 0.0005) {
    const d = assumeDraw(p)!;
    assert.ok(d >= last, `at ${p.toFixed(4)}`);
    last = d;
  }
});
