import { test } from "node:test";
import assert from "node:assert/strict";
import { aside, displayTag, displayTags, dropEchoes } from "../lib/tags.ts";

test("tags print in one shape: compounds joined, spaced dashes read as one name, lower case", () => {
  assert.equal(displayTag("Alt- country"), "alt-country");
  assert.equal(displayTag("Alt -country"), "alt-country");
  assert.equal(displayTag("Indie - Folk"), "indie folk");
  assert.equal(displayTag("Indie – Folk"), "indie folk");
  assert.equal(displayTag("Storyteller"), "storyteller");
  assert.equal(displayTag("  roots   rock "), "roots rock");
  assert.equal(displayTag("americana"), "americana");
  assert.equal(displayTag("Record store"), "record store");
});

test("proper names and acronyms keep their capitals", () => {
  assert.equal(displayTag("American Folk"), "American folk");
  assert.equal(displayTag("R&B"), "R&B");
  assert.equal(displayTag("r&b"), "R&B");
  assert.equal(displayTag("EDM"), "EDM");
  assert.equal(displayTag("Usa"), "USA");
  assert.equal(displayTag("K-Pop"), "K-pop");
  assert.equal(displayTag("Lgbtq+ friendly"), "LGBTQ+ friendly");
  assert.equal(displayTag("Celtic Punk"), "Celtic punk");
});

test("a list of tags prints each once after folding", () => {
  assert.deepEqual(displayTags(["Alt- country", "alt-country", "Country", "country", "Indie - Folk"]), ["alt-country", "country", "indie folk"]);
});

test("an aside that only repeats the name is dropped", () => {
  assert.equal(aside("Sierra Ferrell", "Sierra Ferrell"), undefined);
  assert.equal(aside("Sierra", "sierra"), undefined);
  assert.equal(aside("Beyoncé", "Beyonce"), undefined);
  assert.equal(aside("Sierra", ""), undefined);
  assert.equal(aside("Sierra", undefined), undefined);
  assert.equal(aside("Sierra", "Spanish band"), "Spanish band");
});

test("stored lines lose echoed asides and keep the ones that say something", () => {
  assert.equal(dropEchoes("Sierra Ferrell (Sierra Ferrell); also found Sierra"), "Sierra Ferrell; also found Sierra");
  assert.equal(dropEchoes("Sierra Ferrell (Sierra Ferrell); also found Sierra (Sierra)"), "Sierra Ferrell; also found Sierra");
  assert.equal(dropEchoes("Taft Theatre (holds 2,500), Bogart's (holds 1,200)"), "Taft Theatre (holds 2,500), Bogart's (holds 1,200)");
  assert.equal(dropEchoes("Found and added: Moore Theatre (Seattle)"), "Found and added: Moore Theatre (Seattle)");
  assert.equal(dropEchoes("The National (band)"), "The National (band)");
  assert.equal(dropEchoes("No brackets here"), "No brackets here");
});
