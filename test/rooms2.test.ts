import { test } from "node:test";
import assert from "node:assert/strict";
import { capacityOverride, otherVenueUrl, pickCapacity, sourceOk } from "../lib/agent/capacity.ts";
import { sizeNote, snugFit } from "../lib/agent/evidence.ts";
import { chooseRoom, isPark, isRoom, mergeLadder, openerProblem, roomCheck, roomGrade, roomLadder, roomNameOk, sharedGenres, TWO_NIGHT_MIN, twoNights } from "../lib/agent/rooms.ts";

/* The Oct 25 panel's room findings (C3): a park booked for 15,000, unmeasured clubs over measured arenas, capacities
   read off meeting pages and other venues' pages, and "two nights cover 1,500 (920 across both)". */

const place = (name: string, tags: { id: string; name: string }[]) => ({ name, tags, place: { lat: 35.5, lon: -97.7 } });
const tag = (id: string, name = id.split(":").pop()!) => ({ id, name });
const room = (id: string, capacity?: number, extra: Record<string, unknown> = {}) => ({ id, name: id, tags: [], ...(capacity ? { capacity: { value: capacity, source: "s", quote: "q" } } : {}), ...extra });

test("a park, playground or trail is never a room; a stage in a park is", () => {
  const route66 = place("Route 66 Park", [tag("urn:tag:genre:place:amphitheater"), tag("urn:tag:keyword:place:ponds", "Ponds"), tag("urn:tag:keyword:place:swings", "Swings"), tag("urn:tag:keyword:place:yukon_skate_park", "Yukon skate park"), tag("urn:tag:keyword:place:kid_friendly_hikes", "Kid friendly hikes")]);
  assert.equal(isRoom(route66, 15000), false, "Route 66 Park, Yukon: ponds and swings");
  assert.equal(isRoom(route66, 300), false, "not for 300 either");
  assert.equal(isRoom(place("Lake Overholser", [tag("urn:tag:genre:place:live_music_venue"), tag("urn:tag:keyword:place:ponds", "Ponds"), tag("urn:tag:keyword:place:playground", "Playground")]), 1500), false, "by its tags alone");
  assert.equal(roomNameOk("Robert F. Clement Park", 15000), false, "by its name alone (stored tours too)");
  assert.equal(roomNameOk("Founders' Green", 15000), false);
  assert.equal(isRoom(place("Red Rocks Park and Amphitheatre", [tag("urn:tag:genre:place:amphitheater"), tag("urn:tag:keyword:place:hiking_trails", "Hiking trails")]), 9000), true, "a park's own amphitheatre");
  assert.equal(roomNameOk("Central Park SummerStage", 5000), true);
  assert.equal(roomNameOk("Prospect Park Bandshell", 5000), true);
  assert.equal(roomNameOk("Park West", 1000), true, "a room called Park is still a room");
  assert.equal(isRoom(place("Denver Coliseum", [tag("urn:tag:genre:place:arena"), tag("urn:tag:keyword:place:free_street_parking", "Free street parking")]), 15000), true, "parking isn't a park");
  assert.equal(isPark("Levitt Pavilion Denver", ["Scenic", "Picnic areas"]), false, "a pavilion is a stage");
});

test("a bar by its tags isn't the room from 1,000 up (the Timbre Room for 1,500)", () => {
  const timbre = place("The Timbre Room", [tag("urn:tag:genre:place:live_music_venue"), tag("urn:tag:genre:place:bar")]);
  assert.equal(isRoom(timbre, 1500), false);
  assert.equal(isRoom(timbre, 1000), false);
  assert.equal(isRoom(timbre, 800), true, "a bar can be the room for 800");
  assert.equal(isRoom(place("The Fillmore", [tag("urn:tag:genre:place:ballroom"), tag("urn:tag:genre:place:bar")]), 1500), true, "a ballroom with a bar is a ballroom");
});

test("two nights only when the two together hold the crowd", () => {
  assert.equal(TWO_NIGHT_MIN, 0.5);
  assert.equal(twoNights(room("Tower Theatre", 460), 1500), false, "460 x 2 = 920 doesn't cover 1,500");
  assert.equal(twoNights(room("Dante's", 500), 1500), false);
  assert.equal(twoNights(room("x", 750), 1500), true);
  assert.equal(twoNights(room("x", 778), 1500), true);
  for (const cap of [450, 750, 800, 899]) if (twoNights(room("x", cap), 1500)) assert.ok(cap * 2 >= 1500, `${cap}`);
});

test("from 3,000 up, a measured room at 40–250% of the crowd always beats a room nobody measured", () => {
  for (const cap of [3200, 3500, 4000, 5000, 8000, 12000, 20000]) {
    assert.equal(chooseRoom([room("Strom"), room("measured", cap)], "Strom", 8000)?.id, "measured", `${cap} for 8,000`);
    assert.ok(roomGrade(room("x", cap), 8000) < roomGrade(room("x"), 8000), `${cap}`);
  }
  assert.equal(chooseRoom([room("unmeasured"), room("club", 2000)], "club", 8000)?.id, "unmeasured", "25% of the crowd is still a miss");
  assert.equal(chooseRoom([room("unmeasured"), room("x", 650)], "unmeasured", 1500)?.id, "x", "below 3,000 too: a measured 43% room over a guess");
});

test("a city with no viable room says so, so the planner can try the next one", () => {
  assert.deepEqual(roomCheck([], undefined, 1500), { bookable: false, status: "none", reason: "no room of this kind came back" });
  const unmeasured = roomCheck([room("Strom"), room("Neues Schauspiel")], "Strom", 8000);
  assert.equal(unmeasured.bookable, false);
  assert.equal(unmeasured.status, "unmeasured");
  assert.match(unmeasured.reason!, /8,000/);
  assert.equal(roomCheck([room("Basement East")], undefined, 1500).bookable, true, "an unmeasured club is bookable below 3,000");
  const misfit = roomCheck([room("Lyric", 300), room("Amphitheater", 8000)], undefined, 1500);
  assert.equal(misfit.bookable, false);
  assert.equal(misfit.status, "misfit");
  const ok = roomCheck([room("Strom"), room("Zenith", 5900)], "Strom", 8000);
  assert.deepEqual([ok.bookable, ok.status, ok.room?.id], [true, "measured", "Zenith"]);
  assert.equal(roomCheck([room("a")], "a").bookable, true, "no crowd size: any room");
});

test("capacity quotes from meeting, wedding and venue-finder pages don't count", () => {
  const crystal = { url: "https://www.travelportland.com/meetings/hotel-venue-finder/mcmenamins-crystal-ballroom", text: "McMenamins Crystal Ballroom, Portland. #### Total Meeting Space 7,500 sq ft SEE DETAILS Theater Capacity 800 Banquet Capacity 400 Classroom Capacity 300" };
  assert.equal(pickCapacity("McMenamins Crystal Ballroom", [crystal], "Portland, OR"), null);
  const thalia = { url: "https://www.thaliahallchicago.com/private-events", text: "Private Events and Weddings at Thalia Hall, Chicago — Thalia Hall Capacity 160 seated (rounds) | 220 seated (farmhouse)" };
  assert.equal(pickCapacity("Thalia Hall", [thalia], "Chicago, IL"), null);
  const lyric = { url: "https://www.cvent.com/venues/lexington/entertainment-venue/lyric-theatre-cultural-art-center/venue-1093b3fe", text: "Lyric Theatre & Cultural Arts Center, Lexington. Total meeting space 29,000 sq. ft. Standing capacity 600 Seating capacity 540" };
  assert.equal(pickCapacity("Lyric Theatre & Cultural Arts Center", [lyric], "Lexington, KY"), null);
  // The same words on a plain page about the room still read.
  assert.equal(pickCapacity("McMenamins Crystal Ballroom", [{ url: "https://example.com/portland-venues", text: "McMenamins Crystal Ballroom in Portland has a capacity of 1,500 on its sprung floor." }], "Portland, OR")?.value, 1500);
  assert.equal(sourceOk("Thalia Hall", { source: thalia.url, quote: "Private Events and Weddings at Thalia Hall — Thalia Hall Capacity 160 seated (rounds)" }), false, "a stored answer is re-checked too");
});

test("a quote that names another venue or a sub-room doesn't count", () => {
  // The Broadway (a Bushwick club) is not Manhattan's Broadway Theatre.
  const todaytix = { url: "https://www.todaytix.com/nyc/venues/broadway-theatre", text: "offers New York # Broadway Theatre 1 events on sale · 1761 capacity The Broadway Theatre, an iconic New York house" };
  assert.equal(pickCapacity("The Broadway", [todaytix], "New York, NY"), null);
  assert.equal(pickCapacity("The Broadway", [{ ...todaytix, url: "https://example.com/new-york-rooms" }], "New York, NY"), null, "by the name next to the number alone");
  assert.equal(otherVenueUrl("The Broadway", todaytix.url), true);
  assert.equal(otherVenueUrl("Broadway Theatre", todaytix.url), false);
  // The Timbre Room's number came off Kremwerk's page.
  const kremwerk = { url: "https://dice.fm/venue/kremwerk-complex-xmra", text: "Kremwerk, Timbre Room and Cherry Complex, Seattle, specializing in progressive electronic music and queer culture. Timbre Room Capacity : 600 Phone : +166822935" };
  assert.equal(pickCapacity("The Timbre Room", [kremwerk], "Seattle, WA"), null);
  assert.equal(otherVenueUrl("The Timbre Room", kremwerk.url), true);
  assert.equal(otherVenueUrl("The Fillmore", "https://www.livenation.com/venue/KovZpZAE6eeA/the-fillmore-philadelphia-events"), false, "a city in the slug is fine");
  // The PAC theatre's 2,300, not the coliseum's.
  const pac = { url: "https://example.com/north-charleston", text: "North Charleston Coliseum & Performing Arts Center, Charleston ### North Charleston Performing Arts Center Theater 2,300 Capacity" };
  assert.equal(pickCapacity("North Charleston Coliseum & Performing Arts Center", [pac], "Charleston, SC"), null);
  assert.equal(pickCapacity("North Charleston Coliseum & Performing Arts Center", [{ url: "https://example.com/nc", text: "The North Charleston Coliseum & Performing Arts Center in Charleston: the coliseum has a capacity of 13,000." }], "Charleston, SC")?.value, 13000);
  assert.equal(sourceOk("The Broadway", { source: todaytix.url, quote: "offers New York # Broadway Theatre 1 events on sale · 1761 capacity The Broadway Theatre" }), false);
  assert.equal(sourceOk("Ryman Auditorium", { source: "https://www.wikidata.org/wiki/Q1", quote: "Ryman Auditorium: music venue in Nashville; maximum capacity 2,362 (Wikidata P1083)" }), true);
});

test("hand-checked capacities win, for that room in that city only", () => {
  assert.equal(capacityOverride("McMenamins Crystal Ballroom", "Portland, OR")?.value, 1500);
  assert.equal(capacityOverride("Crystal Ballroom", "Portland, OR")?.value, 1500);
  assert.equal(capacityOverride("Crystal Ballroom", "Portland, ME"), null, "another Portland");
  assert.equal(capacityOverride("Crystal Ballroom", "Boston, MA"), null);
  assert.equal(capacityOverride("North Charleston Coliseum & Performing Arts Center", "North Charleston, SC")?.value, 13000);
  assert.equal(capacityOverride("Thalia Hall", "Chicago, IL")?.value, 800);
  for (const v of ["McMenamins Crystal Ballroom|Portland, OR", "Thalia Hall|Chicago, IL", "North Charleston Coliseum|Charleston, SC"]) {
    const [venue, city] = v.split("|");
    assert.match(capacityOverride(venue!, city!)!.source, /^https:\/\//, `${venue} cites a source`);
  }
});

test("a market's room ladder: venues with a capacity, by the room rules, merged into Qloo's rooms without reordering them", () => {
  const rows = [
    { qid: "Q1", name: "Olympiahalle", description: "indoor arena in Munich, Germany", capacity: 15500, lat: 48.175, lon: 11.55 },
    { qid: "Q2", name: "Zenith", description: "music venue in Munich", capacity: 5900, lat: 48.18, lon: 11.59 },
    { qid: "Q3", name: "Allianz Arena", description: "football stadium in Munich", capacity: 75000 },
    { qid: "Q4", name: "Westpark", description: "park in Munich with an open-air stage area", capacity: 3000 },
    { qid: "Q5", name: "St. Michael", description: "church in Munich", capacity: 3000 },
    { qid: "Q2", name: "Zenith", description: "music venue in Munich", capacity: 5900 },
  ];
  const ladder = roomLadder(rows, 8000);
  assert.deepEqual(ladder.map((r) => r.qid), ["Q2", "Q1"], "a stadium, a park and a church are not rungs; one per item; smallest first");
  const qloo = [room("strom", undefined, { name: "Strom", lat: 48.13, lon: 11.56, affinity: 0.95 }), room("zenith", undefined, { name: "Zenith", lat: 48.181, lon: 11.591, affinity: 0.9 })];
  const { rooms, extras } = mergeLadder(qloo, ladder, 8000);
  assert.deepEqual(rooms.map((r) => r.id), ["strom", "zenith"], "Qloo's order stays");
  assert.equal(rooms[1]!.capacity?.value, 5900);
  assert.match(rooms[1]!.capacity!.source, /wikidata\.org\/wiki\/Q2/);
  assert.equal(rooms[0]!.capacity, undefined);
  assert.deepEqual(extras.map((e) => e.name), ["Olympiahalle"], "the arena Qloo didn't return, for the planner to look up");
  assert.equal(chooseRoom(rooms, "strom", 8000)?.id, "zenith", "the measured room books over the club");
});

test("a support act is 5 to 35 popularity points below the headliner", () => {
  const zach = { name: "Zach Bryan", popularity: 0.97, genres: ["country", "americana", "alt country"] };
  assert.equal(openerProblem(zach, { name: "Peer", popularity: 0.95, genres: ["country", "americana"] }), "a co-headliner, not a support act");
  assert.equal(openerProblem(zach, { name: "Tiny", popularity: 0.55, genres: ["country", "americana"] }), "too small for the headliner's rooms");
  assert.equal(openerProblem(zach, { name: "Kelsey Waldon", popularity: 0.8, genres: ["alt country", "americana"] }), null);
});

test("the tastes two audiences share are named only when both acts are filed under them", () => {
  assert.deepEqual(sharedGenres(["Blues", "Jazz", "Folk"], ["country rock", "country", "americana", "alt country", "folk"], ["country", "folk", "americana"]), ["Folk"]);
  assert.deepEqual(sharedGenres(["Rockabilly", "Glam Rock", "Art Rock"], ["hardcore", "punk"], ["hardcore", "metalcore"]), [], "Turnstile and End It aren't rockabilly");
  assert.deepEqual(sharedGenres(["Red Dirt"], ["alt country", "red dirt"], undefined), [], "no genres for the support: nothing confirmed");
});

test("the day sheet says 'fits' only at 85–130% and 'cover' only when the nights hold the crowd", () => {
  assert.equal(snugFit(1270, 1500), false);
  assert.equal(snugFit(1300, 1500), true);
  assert.equal(snugFit(1950, 1500), true);
  assert.equal(snugFit(2000, 1500), false);
  assert.deepEqual(sizeNote(1400, 1500), { text: "Fits a usual crowd of 1,500.", kind: "fits" });
  assert.equal(sizeNote(1270, 1500).text, "Holds 1,270 of a usual crowd of 1,500 in one night.");
  assert.equal(sizeNote(3000, 1500).text, "Room for 3,000 against a usual crowd of 1,500.");
  assert.match(sizeNote(460, 1500).text, /^Holds 460 of a usual crowd of 1,500: .*second night or a bigger room/);
  assert.match(sizeNote(5000, 1500).text, /reduced configuration/);
  assert.equal(sizeNote(460, 1500, 2).text, "Two nights hold 920 of a usual crowd of 1,500: no room these fans go to here was confirmed to fit it in one.");
  assert.equal(sizeNote(460, 1500, 2).kind, "short");
  assert.equal(sizeNote(821, 1500, 2).text, "Two nights cover a usual crowd of 1,500 (1,642 across both): no room these fans go to here was confirmed to fit it in one.");
  // The rule, across sizes: "cover" exactly when the nights hold the crowd; "Fits" only inside the band.
  for (let cap = 100; cap <= 6000; cap += 37) {
    for (const nights of [1, 2]) {
      const t = sizeNote(cap, 1500, nights).text;
      assert.equal(/\bcover\b/.test(t), nights > 1 && cap * nights >= 1500, `${cap} x ${nights}: ${t}`);
      assert.equal(/^Fits\b/.test(t), nights === 1 && cap >= 1275 && cap <= 1950, `${cap}: ${t}`);
    }
  }
});
