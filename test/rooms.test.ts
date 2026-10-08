import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatesBySize, cityArea, isRoom, nearCity, pickArtist, sharesName, venueTier } from "../lib/agent/rooms.ts";
import { worstLeg } from "../lib/geo/route.ts";

const place = (name: string, ids: string[], extra: Record<string, unknown> = {}) => ({ name, tags: ids.map((id) => ({ id, name: id.split(":").pop()! })), place: { lat: 36.16, lon: -86.78, ...extra } });

test("rooms are filtered by what they are and who the crowd is", () => {
  const honkyTonk = place("Honky Tonk Central", ["urn:tag:genre:place:restaurant:bar", "urn:tag:genre:place:restaurant:live_music_bar", "urn:tag:genre:place:restaurant"]);
  const ryman = place("Ryman Auditorium", ["urn:tag:genre:place:gift_shop", "urn:tag:category:place:museum", "urn:tag:genre:place:performing_arts_theater", "urn:tag:genre:place:concert_hall"]);
  const fair = place("Tennessee Valley Fair", ["urn:tag:genre:place:live_music_venue"]);
  const stadium = place("Nissan Stadium", ["urn:tag:genre:place:stadium"]);
  const club = place("The Basement", ["urn:tag:genre:place:rock_music_club", "urn:tag:genre:place:live_music_venue"]);
  assert.equal(isRoom(honkyTonk, 300), true, "a bar is a room for 300");
  assert.equal(isRoom(honkyTonk, 15000), false, "a bar is not a room for 15,000");
  assert.equal(isRoom(ryman, 2000), true, "a theatre with a gift shop is still a theatre");
  assert.equal(isRoom(fair, 2000), false, "a fair is never a room");
  assert.equal(isRoom(stadium, 2000), false, "a stadium is not a room for 2,000");
  assert.equal(isRoom(stadium, 15000), true, "a stadium is a room for 15,000");
  assert.equal(isRoom(club), true);
  assert.equal(isRoom({ ...club, place: { ...club.place, isClosed: true } }), false);
});

test("venue tiers follow the crowd", () => {
  assert.match(venueTier(300).name, /clubs/);
  assert.match(venueTier(1500).name, /ballrooms/);
  assert.match(venueTier(5000).name, /amphitheatres/);
  assert.match(venueTier(15000).name, /stadiums/);
  assert.equal(venueTier().name, "rooms");
});

test("a place far from the city is a name collision, not a room there", () => {
  const nashville = { lat: 36.16, lon: -86.78, pop: 700_000 };
  assert.equal(cityArea(nashville).radiusM, 22_000);
  assert.equal(nearCity(place("x", []), nashville), true);
  assert.equal(nearCity(place("x", [], { lat: 42.98, lon: -81.25 }), nashville), false, "London, Ontario is not in London, UK");
  assert.equal(nearCity({ place: {} }, nashville), true, "no coordinates: can't tell, so kept");
});

test("an opener can't be the band's own singer or a side project", () => {
  assert.equal(sharesName("Big Thief", "Adrianne Lenker"), false, "names that share nothing pass; the popularity margin catches her");
  assert.equal(sharesName("Zach Bryan", "Zach Bryan Band"), true);
  assert.equal(sharesName("Sierra Ferrell", "Sierra Hull"), true);
  assert.equal(sharesName("The National", "The War on Drugs"), false, "'the' doesn't count");
});

test("rooms are measured in a sensible order", () => {
  const r = (id: string, popularity: number, affinity: number, capacity?: number) => ({ id, name: id, tags: [], popularity, affinity, ...(capacity ? { capacity: { value: capacity, source: "", quote: "" } } : {}) });
  const rooms = [r("a", 0.5, 0.9, 150), r("b", 0.99, 0.8), r("c", 0.9, 0.85), r("d", 0.3, 0.95)];
  assert.deepEqual(candidatesBySize(rooms, 5000).map((x) => x.id), ["b", "c", "d", "a"], "big crowd: best-known first, the known-too-small last");
  assert.deepEqual(candidatesBySize(rooms, 300).map((x) => x.id), ["d", "c", "b", "a"], "small crowd: best-matched first, the known miss last");
  assert.deepEqual(candidatesBySize(rooms, 1500).map((x) => x.id), ["b", "c", "d", "a"], "from a thousand up, size matters more than match");
});

test("the typed artist wins over Qloo's first guess, and the others are offered", () => {
  const found = [
    { name: "Wednesday Campanella", popularity: 0.9 },
    { name: "Wednesday", popularity: 0.8 },
    { name: "Wednesday 13", popularity: 0.6 },
  ];
  const { pick, others } = pickArtist("wednesday", found);
  assert.equal(pick?.name, "Wednesday");
  assert.deepEqual(others.map((o) => o.name), ["Wednesday Campanella", "Wednesday 13"]);
  assert.equal(pickArtist("Big Thief", [{ name: "Big Thief", popularity: 0.99 }, { name: "The Notorious B.I.G.", popularity: 0.95 }]).others.length, 0, "a different name is not offered");
  assert.equal(pickArtist("Big Thief", [{ name: "Big Thief", popularity: 0.99 }, { name: "Big Thief Tribute Band", popularity: 0.2 }]).others.length, 1);
  assert.equal(pickArtist("x", []).pick, undefined);
});

test("the worst leg of a route is found, with what dropping its stop would save", () => {
  const from = { lat: 45.5, lon: -122.7 }; // Portland
  const sf = { lat: 37.8, lon: -122.4 }, austin = { lat: 30.3, lon: -97.7 }, boston = { lat: 42.4, lon: -71.1 }, seattle = { lat: 47.6, lon: -122.3 };
  const w = worstLeg(from, [seattle, sf, austin, boston]);
  assert.ok(w && w.km > 2500, JSON.stringify(w));
  assert.equal(w!.index, 3, "Austin to Boston is the worst leg");
  assert.equal(worstLeg(from, [seattle]), null);
});
