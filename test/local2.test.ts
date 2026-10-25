import { test } from "node:test";
import assert from "node:assert/strict";
import { foldArea, localEvidence, localWords, nameHot, NAME_KM, readLocal, roomVerdict, type LocalPlace, type LocalTile } from "../lib/geo/local.ts";

// The flagship's Portland stop as saved (Sierra Ferrell, Oct 2026): the hottest tile is on the west bank,
// downtown; Buckman is across the Willamette. The old rule (a majority of places within 2 km) named it Buckman
// and said "Dante's sits in it".
const portlandTiles: LocalTile[] = [
  [45.5191, -122.6788, 1],
  [45.5521, -122.6788, 0.987],
  [45.5246, -122.6788, 0.987],
  [45.5191, -122.6569, 0.975],
  [45.5246, -122.6569, 0.958],
  [45.5905, -122.5909, 0.937],
];
const dantes: LocalPlace = { id: "dantes", name: "Dante's", lat: 45.52297, lon: -122.67374, area: "Downtown" };
const portlandPlaces: LocalPlace[] = [
  { name: "The Get Down Music Venue", lat: 45.51814, lon: -122.65955, area: "Buckman" },
  { name: "The Jack London Revue", lat: 45.51943, lon: -122.67643, area: "Downtown" },
  { name: "McMenamins Al's Den", lat: 45.52281, lon: -122.6835, area: "Downtown" },
  dantes,
  { name: "Holocene", lat: 45.51734, lon: -122.65545, area: "Buckman" },
  { name: "McMenamins Crystal Ballroom", lat: 45.52284, lon: -122.68488, area: "Downtown" },
  { name: "Mother Foucault's Bookshop", lat: 45.51761, lon: -122.6609, area: "Buckman", areaTrait: "Commercial district" },
  { name: "Stumptown Coffee Roasters", lat: 45.5214, lon: -122.6827, area: "Downtown", areaTrait: "Downtown west end" },
  { name: "Honey Latte Cafe", lat: 45.51384, lon: -122.65496, area: "Buckman", areaTrait: "Central" },
  { name: "Lollipop Shoppe", lat: 45.5174, lon: -122.66051, area: "Buckman", areaTrait: "Trendy" },
  { name: "Firkin Tavern", lat: 45.50877, lon: -122.65487, area: "Hosford-Abernethy", areaTrait: "Authentic" },
];

test("the hottest blocks are named by the places nearest them, not by a far majority", () => {
  const v = nameHot(portlandTiles, portlandPlaces);
  assert.equal(v.name, "Downtown", "five Buckman places 1.4–2 km away across the river don't outvote the blocks themselves");
  assert.equal(v.trait, "Downtown west end");
  assert.equal(v.votes, 5);
  assert.ok(NAME_KM <= 1);
});

const tile: LocalTile[] = [[45.5, -122.6, 1], [45.51, -122.6, 0.5]];
const at = (km: number, bearing: "n" | "e" = "n") => (bearing === "n" ? { lat: 45.5 + km / 111.2, lon: -122.6 } : { lat: 45.5, lon: -122.6 + km / (111.2 * Math.cos((45.5 * Math.PI) / 180)) });

test("a name needs a quorum, and one place alone must be close", () => {
  // Two names, equal weight: no quorum, so no name rather than a coin toss.
  assert.equal(nameHot(tile, [{ name: "a", ...at(0.3), area: "Kerns" }, { name: "b", ...at(0.3, "e"), area: "Buckman" }]).name, undefined);
  // A near split (about 53 to 47) is no name either.
  assert.equal(nameHot(tile, [{ name: "a", ...at(0.3), area: "Kerns" }, { name: "b", ...at(-0.33), area: "Buckman" }]).name, undefined);
  // One place 0.3 km away names it; one place 0.7 km away does not.
  assert.equal(nameHot(tile, [{ name: "a", ...at(0.3), area: "Kerns" }]).name, "Kerns");
  assert.equal(nameHot(tile, [{ name: "a", ...at(0.7), area: "Kerns" }]).name, undefined);
  // Two places 0.7 km away agree: named.
  assert.equal(nameHot(tile, [{ name: "a", ...at(0.7), area: "Kerns" }, { name: "b", ...at(0.7, "e"), area: "Kerns" }]).name, "Kerns");
  // Past NAME_KM nothing votes.
  assert.equal(nameHot(tile, [{ name: "a", ...at(1.4), area: "Kerns" }, { name: "b", ...at(1.5, "e"), area: "Kerns" }]).name, undefined);
  // The nearer of two names wins clearly.
  assert.equal(nameHot(tile, [{ name: "a", ...at(0.1), area: "Downtown" }, { name: "b", ...at(0.8, "e"), area: "Buckman" }, { name: "c", ...at(0.9), area: "Buckman" }]).name, "Downtown");
  // No tiles, no name.
  assert.deepEqual(nameHot([], [{ name: "a", ...at(0.1), area: "Kerns" }]), { votes: 0, voters: 0 });
});

test("places Qloo files under the city alone abstain, and a place counts once", () => {
  const unnamed = [1, 2, 3, 4, 5].map((i) => ({ name: `u${i}`, ...at(0.05 * i) }));
  const v = nameHot(tile, [...unnamed, { name: "a", ...at(0.3), area: "Capitol Hill" }]);
  assert.equal(v.name, "Capitol Hill");
  assert.equal(v.voters, 1);
  // The same room twice (also an after-show bar) is one vote: Kerns ties Buckman, so no name.
  const twice = { id: "r", name: "r", ...at(0.3), area: "Kerns" };
  assert.equal(nameHot(tile, [twice, twice, { id: "s", name: "s", ...at(0.3, "e"), area: "Buckman" }]).name, undefined);
});

test("area names fold before they are compared", () => {
  assert.equal(foldArea("Hosford-Abernethy"), foldArea("hosford abernethy"));
  assert.equal(foldArea("William Wells Brown Neighborhood"), foldArea("William Wells Brown"));
  assert.equal(foldArea("Neukölln"), foldArea("Neukolln"));
  assert.equal(foldArea("The Gulch"), foldArea("Gulch"));
  assert.notEqual(foldArea("Downtown"), foldArea("Old Town"));
});

test("a room sits in the fans' neighbourhood only when Qloo files it there", () => {
  const local = { tiles: portlandTiles, hot: { lat: 45.5191, lon: -122.6788, name: "Buckman", trait: "Commercial district" } };
  // The stored "Buckman" (old rule, no mark) is not trusted: the stop's own places name it again.
  const r = readLocal(local, dantes, portlandPlaces);
  assert.equal(r.area, "Downtown");
  assert.ok(r.room?.sitsIn);
  assert.equal(roomVerdict(r), "Dante's sits in Downtown, 0.6 km from the hottest blocks.");

  // Roseland, 0.5 km away but filed by Qloo under Old Town: the distance, never "sits in".
  const roseland: LocalPlace = { name: "Roseland Theater", lat: 45.5237, lon: -122.6766, area: "Old Town" };
  const o = readLocal(local, roseland, portlandPlaces);
  assert.equal(o.room?.sitsIn, false);
  assert.equal(roomVerdict(o), "Roseland Theater is 0.5 km from the fans' hottest blocks (Downtown); Qloo files it under Old Town.");
  assert.ok(!/sits in/.test(localWords(o, "Portland").verdict));

  // A room Qloo files under no neighbourhood: the distance, no claim.
  const unfiled = readLocal(local, { name: "Ogden", lat: 45.5215, lon: -122.6788 }, portlandPlaces);
  assert.equal(unfiled.room?.sitsIn, false);
  assert.match(roomVerdict(unfiled), /^Ogden is 0\.3 km from the fans' hottest blocks \(Downtown\)\.$/);

  // A far room on a top-tenth tile of its own says so, with the km.
  const east = readLocal(local, { name: "Revolution Hall", lat: 45.5191, lon: -122.6569, area: "Buckman" }, portlandPlaces);
  assert.equal(east.room?.inHot, true);
  assert.equal(roomVerdict(east), "Revolution Hall is 1.7 km from the fans' hottest blocks (Downtown), on one of their strongest tiles; Qloo files it under Buckman.");
});

test("a run-time name is kept as stored, even with no name", () => {
  const marked = { tiles: portlandTiles, hot: { lat: 45.5191, lon: -122.6788, name: "Old Town", named: "near" as const } };
  assert.equal(readLocal(marked, dantes, portlandPlaces).area, "Old Town");
  assert.equal(readLocal(marked, dantes, portlandPlaces).room?.sitsIn, false);
  const none = { tiles: portlandTiles, hot: { lat: 45.5191, lon: -122.6788, named: "near" as const } };
  assert.equal(readLocal(none, dantes, portlandPlaces).area, undefined);
});

test("with no neighbourhood the words say so plainly and bold nothing", () => {
  // Nashville: Qloo files none of these places under a neighbourhood (probed Oct 25).
  const tiles: LocalTile[] = [[36.1642, -86.7865, 1], [36.16, -86.78, 0.7]];
  const ryman: LocalPlace = { name: "Ryman Auditorium", lat: 36.16125, lon: -86.77847 };
  const war: LocalPlace = { name: "War Memorial Auditorium", lat: 36.1662, lon: -86.7845 };
  const r = readLocal({ tiles }, ryman, [ryman, war]);
  const w = localWords(r, "Nashville");
  assert.equal(w.name, undefined, "nothing bold");
  assert.equal(w.lead, "Inside Nashville, fans over-index most in the blocks around War Memorial Auditorium; Qloo names no neighbourhood there.");
  assert.equal(w.verdict, "Ryman Auditorium is 0.8 km from the fans' hottest blocks.");
  // No place near the blocks at all: still plain, never "one neighbourhood".
  const bare = localWords(readLocal({ tiles }, undefined, []), "Nashville", "Sierra Ferrell fans");
  assert.equal(bare.lead, "Inside Nashville, Sierra Ferrell fans over-index most in one cluster of blocks; Qloo names no neighbourhood there.");
  for (const x of [w, bare]) assert.ok(!/one neighbourhood/.test(`${x.lead}${x.name ?? ""}${x.tail}${x.verdict}`));
  // The nearest place is the booked room itself: not named twice.
  assert.match(localWords(readLocal({ tiles }, war, [war]), "Nashville").lead, /one cluster of blocks/);
});

test("named words bold only the neighbourhood, with Qloo's trait", () => {
  const w = localWords(readLocal({ tiles: portlandTiles }, dantes, portlandPlaces), "Portland");
  assert.deepEqual([w.lead, w.name, w.tail], ["Inside Portland, fans over-index most around ", "Downtown (downtown west end)", "."]);
});

test("the pitch evidence carries the same rule", () => {
  const local = { tiles: portlandTiles };
  assert.equal(localEvidence(readLocal(local, dantes, portlandPlaces), "Portland", "Sierra Ferrell"), "Qloo's street-level heatmap puts Sierra Ferrell fans' strongest area in Portland around Downtown, downtown west end; Dante's sits in Downtown, 0.6 km from the hottest blocks.");
  const roseland: LocalPlace = { name: "Roseland Theater", lat: 45.5237, lon: -122.6766, area: "Old Town" };
  const e = localEvidence(readLocal(local, roseland, portlandPlaces), "Portland", "Sierra Ferrell");
  assert.match(e, /Roseland Theater is 0\.5 km from those blocks\. Qloo files Roseland Theater under Old Town\. Do not write that Roseland Theater is in Downtown\.$/);
  const n = localEvidence(readLocal({ tiles: [[36.1642, -86.7865, 1]] }, { name: "Ryman Auditorium", lat: 36.16125, lon: -86.77847 }, []), "Nashville", "Sierra Ferrell");
  assert.match(n, /in one cluster of blocks \(Qloo names no neighbourhood there\); Ryman Auditorium is 0\.8 km from those blocks\. Name no neighbourhood for the fans\.$/);
});
