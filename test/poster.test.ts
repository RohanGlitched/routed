import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, breaks, CAP, chordAt, fitTitle, MAX_STRETCH, MIN_LINE, MIN_STRETCH, STAMP_BASELINE, stampCity, supportBand, TITLE_BOX } from "../lib/posterfit.ts";

const NAMES = ["Fontaines D.C.", "MJ Lenderman", "Jamie xx", "Wet Leg", "Wednesday", "Durand Jones & The Indications", "Big Thief", "Sierra Ferrell", "Japanese Breakfast", "Waxahatchee", "Ghost", "King Gizzard & the Lizard Wizard"];
const text = (name: string) => fitTitle(name).map((l) => l.text);

test("a short part of a name is never left on a line of its own", () => {
  for (const name of NAMES) for (const lines of breaks(name)) if (lines.length > 1) for (const l of lines) assert.ok(l.length > MIN_LINE, `${name}: "${l}"`);
  assert.deepEqual(text("Fontaines D.C."), ["FONTAINES D.C."]);
  assert.deepEqual(text("MJ Lenderman"), ["MJ LENDERMAN"]);
  assert.deepEqual(text("Jamie xx"), ["JAMIE XX"]);
  assert.deepEqual(text("Wet Leg"), ["WET LEG"]);
  assert.deepEqual(text("Big Thief"), ["BIG THIEF"]);
  assert.deepEqual(text("Wednesday"), ["WEDNESDAY"]);
});

test("a long name takes two lines of similar size", () => {
  const durand = fitTitle("Durand Jones & The Indications");
  assert.equal(durand.length, 2);
  assert.ok(durand.every((l) => l.text.length > MIN_LINE));
  const sizes = durand.map((l) => l.size);
  assert.ok(Math.max(...sizes) / Math.min(...sizes) < 1.3, `sizes ${sizes}`);
  assert.deepEqual(text("Sierra Ferrell"), ["SIERRA", "FERRELL"]);
  assert.deepEqual(text("Japanese Breakfast"), ["JAPANESE", "BREAKFAST"]);
});

test("no line is stretched past the cap, and every line sits inside the block", () => {
  const box = TITLE_BOX;
  for (const name of NAMES) {
    const lines = fitTitle(name);
    let floor = box.top - 0.01;
    for (const l of lines) {
      assert.ok(l.stretch <= MAX_STRETCH + 1e-9 && l.stretch >= MIN_STRETCH - 1e-9, `${name}: stretch ${l.stretch}`);
      // The width drawn is the line's natural width at that size, times the stretch: nothing is forced to the column.
      assert.ok(Math.abs(l.width - advance(l.text) * l.size * l.stretch) < 0.01, `${name}: width`);
      assert.ok(l.x >= box.x - 0.01 && l.x + l.width <= box.x + box.width + 0.01, `${name}: "${l.text}" runs outside the margins`);
      assert.ok(l.y - CAP * l.size >= floor, `${name}: "${l.text}" overlaps the line above or the season line`);
      assert.ok(l.y <= box.bottom + 0.01, `${name}: "${l.text}" sits on the rule`);
      floor = l.y;
    }
  }
});

test("a short line that can't fill the column is set smaller and centred, not stretched", () => {
  for (const l of fitTitle("Sierra Ferrell")) {
    assert.ok(l.stretch <= MAX_STRETCH + 1e-9);
    assert.ok(Math.abs(l.x + l.width / 2 - (TITLE_BOX.x + TITLE_BOX.width / 2)) < 0.01, "centred");
  }
});

test("long fan-city names stay inside the stamp ring", () => {
  const room = chordAt(STAMP_BASELINE);
  for (const city of ["San Antonio", "Frankfurt am Main", "Salt Lake City", "Philadelphia", "Minneapolis", "Dublin"]) {
    const s = stampCity(city);
    const t = city.toUpperCase();
    const drawn = s.textLength ?? (advance(t) + s.track * t.length) * s.size * 1.08;
    assert.ok(drawn <= room + 0.01, `${city}: ${drawn} > ${room}`);
    assert.ok(s.size >= 10 && s.size <= 12);
  }
  assert.deepEqual(stampCity("Dublin"), { size: 12, track: 0.1 });
});

test("the band names the support act, or says it isn't announced", () => {
  assert.equal(supportBand("Kelsey Waldon"), "WITH KELSEY WALDON");
  assert.equal(supportBand(undefined), "SUPPORT TO BE ANNOUNCED");
});
