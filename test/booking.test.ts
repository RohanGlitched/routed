import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCapacities, sameVenue } from "../lib/agent/capacity.ts";
import { chooseRoom, cleanName, genresOf, isSideMember, openerProblem, pickSupport, roomGrade, sharesGenre, twoNights } from "../lib/agent/rooms.ts";
import { findMarket, nearestMarket } from "../lib/geo/markets.ts";
import { isAnchor, keepAnchors, legGroups, longLegs, MAX_LEG_KM, orderStops, pathKm, radiusFor, repairLegs, schedule, tooClose } from "../lib/geo/route.ts";

/** A ranked city for the routing rules, from the real market list. */
const city = (s: string, rank: number) => {
  const m = findMarket(s);
  assert.ok(m, `no market for ${s}`);
  return { id: `${m.name}-${m.state}`, name: m.name, rank, lat: m.lat, lon: m.lon, pop: m.pop };
};
const yes = async () => true;

/* ───────────── the leg rule ───────────── */

test("a tour split across two coasts is pulled into one: no leg between shows over 1,800 km", async () => {
  const from = city("Seattle", 0);
  const stops = [city("Seattle", 1), city("Portland, OR", 2), city("San Francisco", 3), city("Los Angeles", 4), city("San Diego", 6), city("Boston", 5), city("New York", 7)];
  assert.equal(legGroups(stops).length, 2, "West Coast and East Coast can't reach each other");
  const pool = [...stops, city("Vancouver", 8), city("Sacramento", 9), city("Phoenix", 10), city("Philadelphia", 11), city("Salt Lake City", 12)].sort((a, b) => a.rank - b.rank);
  const { stops: fixed, swaps } = await repairLegs({ from, stops, pool, usable: yes, weight: (c) => 1 / Math.sqrt(c.rank) });
  assert.equal(fixed.length, stops.length);
  assert.deepEqual(longLegs(from, orderStops(from, fixed)), [], fixed.map((s) => s.name).join(", "));
  assert.deepEqual(swaps.map((s) => s.out.name).sort(), ["Boston", "New York"], "the smaller group gives way");
  assert.ok(fixed.every((s) => !["Boston", "New York", "Philadelphia"].includes(s.name)));
});

test("the group with the artist's strongest cities is kept, not the one with more big markets", async () => {
  // Starting in Portland: San Francisco #1, Seattle #2, Portland #3 in the west; Boston, New York, Chicago in the east.
  const from = city("Portland, OR", 0);
  const stops = [city("San Francisco", 1), city("Seattle", 2), city("Portland, OR", 3), city("Boston", 4), city("Philadelphia", 7), city("Chicago", 8), city("New York", 9)];
  const pool = [...stops, city("Los Angeles", 10), city("Vancouver", 12), city("San Diego", 13), city("Sacramento", 15), city("Salt Lake City", 18)].sort((a, b) => a.rank - b.rank);
  const { stops: fixed } = await repairLegs({ from, stops, pool, usable: yes, weight: (c) => 1 / Math.sqrt(c.rank) });
  const names = fixed.map((s) => s.name);
  assert.ok(["San Francisco", "Seattle", "Portland"].every((n) => names.includes(n)), names.join(", "));
  assert.deepEqual(longLegs(from, orderStops(from, fixed)), []);
});

test("the leg rule only books a city that has rooms, and flags what it can't fix", async () => {
  const from = city("Seattle", 0);
  const stops = [city("Seattle", 1), city("Portland, OR", 2), city("Boston", 3)];
  const pool = [...stops, city("Vancouver", 4), city("Spokane", 5)];
  const noRooms = new Set(["Vancouver-British Columbia"]);
  const { stops: fixed } = await repairLegs({ from, stops, pool, usable: async (c) => !noRooms.has(c.id) });
  assert.ok(fixed.some((s) => s.name === "Spokane"), "Vancouver has no rooms, so Spokane closes the gap");
  // Nothing in the pool can reach: the long leg stays, for the day sheet to flag.
  const stuck = await repairLegs({ from, stops, pool: stops, usable: yes });
  assert.equal(longLegs(from, orderStops(from, stuck.stops)).length, 1);
  assert.ok(longLegs(from, orderStops(from, stuck.stops))[0]!.km > MAX_LEG_KM);
});

test("the shortest drive is found (Nashville, Asheville, Lexington, Memphis beats doubling back)", () => {
  const from = city("Nashville", 0);
  const stops = [city("Nashville", 2), city("Lexington", 9), city("Asheville", 1), city("Memphis", 18)];
  const route = orderStops(from, stops);
  const doubledBack = [stops[0]!, stops[1]!, stops[2]!, stops[3]!];
  assert.ok(pathKm(from, route) <= pathKm(from, doubledBack), route.map((s) => s.name).join(" > "));
});

/* ───────────── the radius clause and the anchor rule ───────────── */

test("the radius clause splits one audience, but never two major markets", () => {
  assert.equal(tooClose(city("London, UK", 1), city("Brighton", 2)), true);
  assert.equal(tooClose(city("New York", 1), city("Philadelphia", 2)), false, "New York and Philadelphia each carry a show");
  assert.equal(tooClose(city("Washington DC", 1), city("Baltimore", 2)), true);
  // The UK radius is tight: a real tour plays London and Brighton, Glasgow and Edinburgh.
  assert.equal(tooClose(city("London, UK", 1), city("Brighton", 2), radiusFor("uk")), false);
  assert.equal(tooClose(city("Glasgow", 1), city("Edinburgh", 2), radiusFor("uk")), false);
  assert.equal(tooClose(city("Manchester, UK", 1), city("Liverpool", 2), radiusFor("uk")), true);
  assert.equal(isAnchor(city("London, UK", 3)), true);
  assert.equal(isAnchor(city("London, UK", 14)), false, "outside the top ten it is a city like any other");
  assert.equal(isAnchor(city("Brighton", 2)), false);
});

test("London is never dropped from a UK tour by the radius clause", async () => {
  // Wet Leg's tour as first booked: Brighton (#2) and Cambridge (#19) went in, so London (#3) was skipped.
  const ranked = [city("Bristol", 1), city("Brighton", 2), city("London, UK", 3), city("Manchester, UK", 4), city("Glasgow", 6), city("Newcastle", 12), city("Belfast", 15), city("Cambridge, UK", 19), city("Dublin", 20)];
  const booked = ["Brighton", "Cambridge", "Bristol", "Manchester", "Newcastle upon Tyne", "Glasgow"].map((n) => ranked.find((c) => c.name === n)!);
  const { stops, added } = await keepAnchors(booked, ranked, 6, yes);
  const names = stops.map((s) => s.name);
  assert.ok(names.includes("London"), names.join(", "));
  assert.ok(!names.includes("Brighton") && !names.includes("Cambridge"), "the smaller cities inside London's radius give way");
  assert.equal(added[0]!.anchor.name, "London");
  assert.equal(stops.length, 6, "the freed slot is refilled from the ranking");
  for (const a of stops) for (const b of stops) if (a !== b) assert.equal(tooClose(a, b), false, `${a.name} ~ ${b.name}`);
});

test("an anchor the route can't reach without a long leg is left out", async () => {
  // A West Coast run: Chicago (#8, a major market) is 3,000 km away and stays off.
  const ranked = [city("San Francisco", 1), city("Seattle", 2), city("Portland, OR", 3), city("Los Angeles", 4), city("Chicago", 8)];
  const { stops, added } = await keepAnchors(ranked.slice(0, 4), ranked, 4, yes);
  assert.equal(added.length, 0);
  assert.ok(!stops.some((s) => s.name === "Chicago"));
});

test("an anchor already on the tour changes nothing", async () => {
  const ranked = [city("London, UK", 1), city("Bristol", 2), city("Manchester, UK", 3)];
  const { stops, added } = await keepAnchors(ranked, ranked, 3, yes);
  assert.equal(added.length, 0);
  assert.equal(stops.length, 3);
});

/* ───────────── rooms sized to the crowd ───────────── */

const room = (id: string, capacity?: number) => ({ id, name: id, tags: [], ...(capacity ? { capacity: { value: capacity, source: "s", quote: "q" } } : {}) });

test("a known fit beats the agent's unconfirmed room; two nights beat a room nobody measured", () => {
  const rooms = [room("agent's pick"), room("fits", 1400), room("two nights", 700), room("too big", 23_500)];
  assert.equal(chooseRoom(rooms, "agent's pick", 1500)?.id, "fits");
  assert.equal(chooseRoom(rooms.filter((r) => r.id !== "fits"), "agent's pick", 1500)?.id, "two nights");
  assert.equal(chooseRoom([room("agent's pick"), room("too big", 23_500)], "too big", 5000)?.id, "agent's pick", "a room 4.7 times the crowd is never booked while another room is left");
  assert.equal(chooseRoom([room("unmeasured"), room("arena", 32_000)], "arena", 8000)?.id, "arena", "four times the crowd: a reduced configuration beats an unmeasured room for 8,000");
  assert.equal(chooseRoom([room("unmeasured"), room("theatre", 5000)], "unmeasured", 1500)?.id, "theatre", "a theatre for 1,500 with the balcony closed");
  assert.equal(chooseRoom([room("too big", 23_500), room("too small", 1400)], undefined, 5000)?.id, "too small", "nothing else left: the nearest size (log scale)");
  assert.equal(chooseRoom([room("a", 2000), room("b", 1400)], "b", 1500)?.id, "b", "among fits, the agent's choice");
  assert.equal(chooseRoom([room("a"), room("b")], "b")?.id, "b", "no crowd size: the agent's choice");
});

test("two nights only when the room holds 30-60% of the crowd", () => {
  assert.equal(twoNights(room("x", 778), 1500), true);
  assert.equal(twoNights(room("x", 1000), 1500), false, "a one-night fit");
  assert.equal(twoNights(room("x", 150), 3000), false, "a 150-cap bar for 3,000 is no two-night stand");
  assert.equal(twoNights(room("x"), 1500), false);
  assert.ok(roomGrade(room("x", 1000), 1500) < roomGrade(room("x", 700), 1500));
  assert.ok(roomGrade(room("x", 700), 1500) < roomGrade(room("x"), 1500));
  assert.ok(roomGrade(room("x"), 1500) < roomGrade(room("x", 67_700), 15_000));
});

test("a two-night stand takes two dates on the calendar", () => {
  const from = city("Nashville", 0);
  const stops = [{ ...city("Nashville", 1), nights: 2 }, city("Louisville", 2), city("Cincinnati", 3)];
  const legs = schedule(from, stops, "2027-04-08");
  assert.deepEqual(legs.map((l) => [l.date, l.nights]), [["2027-04-08", 2], ["2027-04-10", 1], ["2027-04-11", 1]]);
});

test("a Wikidata item counts only when it is the room, not a room inside it", () => {
  assert.equal(sameVenue("Benaroya Hall", "Nordstrom Recital Hall", "recital hall that is part of Benaroya Hall in Seattle"), false);
  assert.equal(sameVenue("Benaroya Hall", "Benaroya Hall", "concert hall in Seattle, Washington"), true);
  assert.equal(sameVenue("Lensic Performing Arts Center", "Lensic Theater", "theater in Santa Fe, New Mexico"), true);
  assert.equal(sameVenue("Ryman Auditorium", "Ryman Auditorium", "music venue in Nashville"), true);
  assert.equal(sameVenue("The Fillmore", "Fillmore Auditorium", "music venue in Denver"), true);
  assert.equal(sameVenue("Wonder Ballroom", "Crystal Ballroom", "ballroom in Portland, Oregon"), false, "a namesake shares only the generic word");
});

test("a web page's number counts only for this room, in this city, next to its name", async () => {
  const { pickCapacity } = await import("../lib/agent/capacity.ts");
  // "The Ark" is not in "Docklands": whole words only.
  assert.equal(pickCapacity("The Ark", [{ url: "https://en.wikipedia.org/wiki/Point_Theatre", text: "The Point Theatre in the Dublin Docklands had a seated capacity of 6,300." }], "Dublin"), null);
  // Komedia Bath is not Komedia Bristol.
  assert.equal(pickCapacity("Komedia", [{ url: "https://musiciansunion.org.uk/venue/komedia-bath", text: "Komedia in Bath has a capacity of 2,124 in the main auditorium." }], "Bristol, UK"), null);
  // A listing page: the 4,500 belongs to another venue far from this name.
  const listing = `Theatre Royal Brighton is a Grade II listed theatre.${" Lorem ipsum dolor sit amet.".repeat(12)} The Brighton Centre has a capacity of 4,500 seated.`;
  assert.equal(pickCapacity("Theatre Royal Brighton", [{ url: "https://theatreinbrighton.co.uk/venues", text: listing }], "Brighton, UK"), null);
  // A recital room on the same page isn't the hall.
  assert.equal(pickCapacity("National Concert Hall", [{ url: "https://x.example/nch-dublin", text: "At the National Concert Hall in Dublin, the recital room, occasionally used for performances, has a capacity of 100." }], "Dublin"), null);
  // The right number still comes through.
  assert.equal(pickCapacity("O2 Academy Bristol", [{ url: "https://news.pollstar.com/o2-academy-bristol", text: "The acoustic transformation at the 1,600-capacity O2 Academy Bristol is the latest." }], "Bristol, UK")?.value, 1600);
});

test("venue names are cleaned for the poster", () => {
  assert.equal(cleanName("Think Tank?"), "Think Tank");
  assert.equal(cleanName("  The  Fillmore "), "The Fillmore");
  assert.equal(cleanName("“Lyric Theatre”"), "Lyric Theatre");
  assert.equal(cleanName("Yeah Yeah Yeahs!"), "Yeah Yeah Yeahs!", "an exclamation mark can be part of a name");
});

test("one capacity per venue: the first stored answer wins, a found number beats not found", () => {
  const stored = { "id:wonder": { value: 778, source: "a", quote: "" }, "id:basement": null };
  const mine = { "id:wonder": { value: 3000, source: "b", quote: "" }, "id:basement": { value: 150, source: "c", quote: "" }, "id:new": null };
  const all = mergeCapacities(mine, stored);
  assert.equal(all["id:wonder"]?.value, 778);
  assert.equal(all["id:basement"]?.value, 150);
  assert.equal(all["id:new"], null);
});

/* ───────────── openers ───────────── */

const fontaines = { id: "fdc", name: "Fontaines D.C.", popularity: 0.989, genres: ["post punk", "indie rock", "irish"] };

test("a band's own singer, or a member of another band, doesn't open", () => {
  const grian = { name: "Grian Chatten", popularity: 0.87, genres: ["post punk"], description: "Grian Chatten is an Irish singer-songwriter best known as the lead vocalist and frontman of the critically acclaimed Dublin post-punk band Fontaines D.C." };
  assert.match(openerProblem(fontaines, grian)!, /member/);
  const kirk = "Kirk Hammett is an American musician best known as the lead guitarist of the heavy metal band Metallica.";
  assert.equal(isSideMember(kirk), true);
  assert.equal(isSideMember("The Highwomen is an American country music supergroup formed in 2019, consisting of Brandi Carlile and Maren Morris."), false, "a band's own description isn't membership");
  assert.equal(isSideMember("Soccer Mommy is an American singer-songwriter known for confessional indie rock."), false);
  assert.equal(openerProblem(fontaines, { name: "The Murder Capital", popularity: 0.8, genres: ["post punk"], description: "The Murder Capital are an Irish post-punk band from Dublin." }), null);
});

test("a support act shares a genre with the headliner", () => {
  assert.equal(openerProblem(fontaines, { name: "Billy Strings", popularity: 0.92, genres: ["bluegrass", "americana"] }), "no genre in common");
  assert.equal(openerProblem({ name: "Parcels", popularity: 0.97, genres: ["indie rock", "funk", "disco", "australian"] }, { name: "Riley Green", popularity: 0.9, genres: ["country", "usa"] }), "no genre in common");
  assert.equal(sharesGenre(["Post-Punk"], ["post punk"]), true, "spellings fold together");
  assert.equal(sharesGenre(["irish", "post punk"], ["irish", "folk"]), false, "a nationality is not a genre");
  assert.equal(sharesGenre([], ["country"]), true, "no genres on Qloo: nothing to judge");
  assert.equal(sharesGenre(["post punk", "indie rock", "alternative rock"], ["rock", "folk rock", "country", "alternative rock"]), false, "one umbrella genre isn't enough");
  assert.equal(sharesGenre(["post punk", "indie rock", "alternative rock"], ["indie rock", "alternative rock", "shoegaze"]), true, "two umbrella genres are");
  assert.deepEqual(genresOf([{ id: "urn:tag:genre:music:Post Punk", name: "Post Punk" }, { id: "urn:tag:subgenre:qloo:Emo", name: "Emo" }, { id: "urn:tag:theme:qloo:Love", name: "Love" }, { id: "urn:tag:genre:qloo:USA", name: "Usa" }]), ["post punk", "emo"]);
});

test("a support act is clearly smaller than the headliner and isn't the headliner", () => {
  assert.equal(openerProblem(fontaines, { id: "fdc", name: "Fontaines D.C.", genres: [] }), "the headliner");
  assert.equal(openerProblem(fontaines, { name: "IDLES", popularity: 0.99, genres: ["post punk"] }), "not smaller than the headliner");
  assert.equal(openerProblem({ name: "Sierra Ferrell", genres: ["country"] }, { name: "Sierra Hull", genres: ["country"] }), "shares the headliner's name");
});

test("one support act for the whole run: the agent's most frequent pick", () => {
  const a = { id: "a", affinity: 0.9 }, b = { id: "b", affinity: 0.8 }, c = { id: "c", affinity: 0.95 };
  const stops = [
    { openers: [a, b], openerId: "b" },
    { openers: [b, c], openerId: "b" },
    { openers: [a, c], openerId: "a" },
  ];
  assert.equal(pickSupport(stops)?.id, "b");
  // No picks: the artist who turns up in the most cities.
  assert.equal(pickSupport([{ openers: [a, c] }, { openers: [c] }])?.id, "c");
  assert.equal(pickSupport([{ openers: [] }]), undefined);
});

/* ───────────── city names ───────────── */

test("a market is named the way a booker writes it, not after a census place", () => {
  assert.equal(nearestMarket({ lat: 38.41, lon: -82.7 })?.name, "Ashland", "not Meads");
  assert.equal(findMarket("Meads, KY"), null);
  assert.equal(nearestMarket({ lat: 51.37, lon: 1.42 }, "uk")?.name, "Margate");
});

/* ───────────── the outside check ───────────── */

test("the outside check counts a tour's cities against the ones the artist really played", async () => {
  const { outsideRow, realMarkets, realTourFor, REAL_TOURS } = await import("../lib/outside.ts");
  const fdc = realTourFor("Fontaines D.C.")!;
  assert.ok(fdc, "Fontaines D.C. has a researched tour");
  const played = realMarkets(fdc);
  // Wolverhampton is placed on the nearest touring market by its coordinates.
  assert.ok(played.size >= 8, String(played.size));
  const row = outsideRow(fdc, [{ marketId: [...played][0]!, city: "a" }, { marketId: "nowhere-xx", city: "b" }], [{ city: "unplaced" }, { marketId: [...played][1]!, city: "c" }]);
  assert.deepEqual([row.routed.hits, row.routed.of, row.guess.hits, row.guess.of], [1, 2, 1, 1], "an unplaced model-alone stop is left out, not counted as a miss");
  for (const t of REAL_TOURS.filter((x) => x.found)) assert.ok(t.sources.length > 0, `${t.artist} has a source`);
  assert.equal(realTourFor("Jamie xx"), undefined, "no researched tour, no row");
});
