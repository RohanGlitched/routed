import { test } from "node:test";
import assert from "node:assert/strict";
import { findMarket, marketById } from "../lib/geo/markets.ts";
import {
  borderHours,
  capCountries,
  clusterCities,
  countryCheck,
  countryOf,
  describeTradeOff,
  driveHours,
  homeCity,
  keepHome,
  KM_PER_SHOW_VAN,
  legCost,
  legGroups,
  longLegs,
  MAX_LEG_KM,
  orderStops,
  pathKm,
  repairLegs,
  roadKm,
  schedule,
  travel,
  VAN_LEG_KM,
  worstLeg,
} from "../lib/geo/route.ts";

const yes = async () => true;
const weight = (c: { rank: number }) => 1 / Math.sqrt(c.rank);
const m = (s: string) => {
  const r = findMarket(s);
  assert.ok(r, `no market for ${s}`);
  return r;
};
const city = (s: string, rank: number) => {
  const r = m(s);
  return { id: `${r.name}-${r.state}`, name: r.name, rank, lat: r.lat, lon: r.lon, pop: r.pop };
};

/* ───────────── the flagship: Sierra Ferrell from Nashville (tour bnwvpmjuet) ───────────── */

// The top of Qloo's fan map for Sierra Ferrell, as saved on the flagship tour (rank, coordinates).
const FAN_MAP: [string, string, number, number, number][] = [
  ["asheville-us-nc", "Asheville", 1, 35.6009, -82.554],
  ["nashville-us-tn", "Nashville", 2, 36.1659, -86.7844],
  ["portland-us-or", "Portland", 3, 45.5234, -122.6762],
  ["denver-us-co", "Denver", 4, 39.7392, -104.9847],
  ["austin-us-tx", "Austin", 5, 30.2672, -97.7431],
  ["santa-fe-us-nm", "Santa Fe", 6, 35.687, -105.9378],
  ["boulder-us-co", "Boulder", 7, 40.015, -105.2706],
  ["knoxville-us-tn", "Knoxville", 8, 35.9606, -83.9207],
  ["lexington-us-ky", "Lexington", 9, 37.9887, -84.4777],
  ["louisville-us-ky", "Louisville", 10, 38.2542, -85.7594],
  ["cincinnati-us-oh", "Cincinnati", 11, 39.1271, -84.5144],
  ["bend-us-or", "Bend", 12, 44.0582, -121.3153],
  ["murfreesboro-us-tn", "Murfreesboro", 13, 35.8456, -86.3903],
  ["new-orleans-us-la", "New Orleans", 14, 29.9547, -90.0751],
  ["portland-us-me", "Portland", 15, 43.6574, -70.2589],
  ["seattle-us-wa", "Seattle", 16, 47.6062, -122.3321],
  ["saint-george-us-ut", "Saint George", 17, 37.1041, -113.5841],
  ["memphis-us-tn", "Memphis", 18, 35.1495, -90.049],
  ["pittsburgh-us-pa", "Pittsburgh", 19, 40.4406, -79.9959],
  ["missoula-us-mt", "Missoula", 20, 46.8721, -113.994],
  ["charleston-us-sc", "Charleston", 21, 32.7763, -79.9327],
  ["palm-springs-us-ca", "Palm Springs", 22, 33.7207, -116.2168],
  ["chattanooga-us-tn", "Chattanooga", 23, 35.0456, -85.3097],
  ["salt-lake-city-us-ut", "Salt Lake City", 24, 40.7608, -111.8911],
  ["salinas-us-ca", "Salinas", 25, 36.6777, -121.6555],
];
const FAN = FAN_MAP.map(([id, name, rank, lat, lon]) => ({ id, name, rank, lat, lon, pop: marketById(id)?.pop }));
const fan = (name: string) => FAN.find((c) => c.name === name)!;
const NASHVILLE = { lat: 36.1659, lon: -86.7844 };
// The eight cities the flagship had before the leg rule swapped Asheville (#1) for Knoxville (#8).
const FLAGSHIP = ["Asheville", "Nashville", "Lexington", "Austin", "Santa Fe", "Denver", "Bend", "Portland"].map(fan);

test("the flagship keeps Asheville: an order with every leg under 1,800 km exists, and the router finds it", async () => {
  const route = orderStops(NASHVILLE, FLAGSHIP);
  assert.deepEqual(longLegs(NASHVILLE, route), [], route.map((s) => s.name).join(" > "));
  assert.equal(worstLeg(NASHVILLE, route)!.km, 1788);
  assert.deepEqual(route.map((s) => s.name), ["Nashville", "Asheville", "Lexington", "Austin", "Santa Fe", "Denver", "Bend", "Portland"]);
  const { stops, swaps } = await repairLegs({ from: NASHVILLE, stops: FLAGSHIP, pool: FAN, usable: yes, weight, radius: 150 });
  assert.deepEqual(swaps, [], "no city is swapped out when an order works");
  assert.ok(stops.some((s) => s.name === "Asheville"));
});

test("the order search is exact: no order of the stops has fewer long legs or less road", () => {
  const stops = ["Asheville", "Portland", "Denver", "Austin", "Santa Fe", "Bend", "Lexington"].map(fan);
  const perms = (xs: typeof stops): (typeof stops)[] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  const score = (o: typeof stops) => longLegs(NASHVILLE, o).length * 1e7 + pathKm(NASHVILLE, o);
  const best = Math.min(...perms(stops).map(score));
  assert.equal(score(orderStops(NASHVILLE, stops)), best);
  // A fixed opener stays first, and the rest is still the best order behind it.
  const fixed = orderStops(NASHVILLE, stops, { first: "denver-us-co" });
  assert.equal(fixed[0]!.name, "Denver");
  const bestBehind = Math.min(...perms(stops.filter((s) => s.name !== "Denver")).map((p) => score([fan("Denver"), ...p])));
  assert.equal(score(fixed), bestBehind);
});

test("when no order works, the swap keeps the higher-ranked city", async () => {
  // A star around Chicago with a 700 km cap: Detroit, Minneapolis and St. Louis each reach Chicago but not each other.
  const from = city("Chicago", 0);
  const stops = [city("Chicago", 1), city("Detroit", 2), city("Minneapolis", 3), city("St. Louis", 9)];
  assert.equal(legGroups(stops, 700).length, 1);
  assert.equal(longLegs(from, orderStops(from, stops, { max: 700 }), 700).length, 1, "no order avoids a long leg");
  const pool = [...stops, city("Indianapolis", 4), city("Milwaukee", 5), city("Columbus, OH", 6), city("Kansas City", 7), city("Grand Rapids", 10)].sort((a, b) => a.rank - b.rank);
  const { stops: fixed, swaps } = await repairLegs({ from, stops, pool, usable: yes, weight, max: 700 });
  assert.deepEqual(swaps.map((s) => s.out.name), ["St. Louis"], "the lower-ranked end of the long leg gives way");
  assert.deepEqual(longLegs(from, orderStops(from, fixed, { max: 700 }), 700), []);
});

test("a hometown stop marked keep is never swapped out", async () => {
  const from = city("Chicago", 0);
  const stops = [city("Chicago", 1), city("Detroit", 2), city("Minneapolis", 3), city("St. Louis", 9)];
  const pool = [...stops, city("Indianapolis", 4), city("Milwaukee", 5), city("Kansas City", 7)].sort((a, b) => a.rank - b.rank);
  const { stops: fixed } = await repairLegs({ from, stops, pool, usable: yes, weight, max: 700, keep: (c) => c.name === "St. Louis" });
  assert.ok(fixed.some((s) => s.name === "St. Louis"), fixed.map((s) => s.name).join(", "));
});

/* ───────────── the shape of a run: km per show and the leg cap ───────────── */

test("a van run's leg cap is an input: one travel day at most", async () => {
  const { stops } = await repairLegs({ from: NASHVILLE, stops: FLAGSHIP, pool: FAN, usable: yes, weight, radius: 150, max: VAN_LEG_KM, maxSwaps: 8 });
  const route = orderStops(NASHVILLE, stops, { max: VAN_LEG_KM });
  assert.deepEqual(longLegs(NASHVILLE, route, VAN_LEG_KM), [], route.map((s) => s.name).join(" > "));
  assert.ok(stops.some((s) => s.name === "Asheville"));
});

test("km per show: the flagship tightens toward a van run and says what it gave up", async () => {
  const before = pathKm(NASHVILLE, orderStops(NASHVILLE, FLAGSHIP));
  assert.ok(before / FLAGSHIP.length > KM_PER_SHOW_VAN, `${before} km for 8 shows`);
  const { stops, swaps, tradeOff } = await repairLegs({ from: NASHVILLE, stops: FLAGSHIP, pool: FAN, usable: yes, weight, radius: 150, kmPerShow: KM_PER_SHOW_VAN });
  assert.ok(swaps.length >= 1 && swaps.every((s) => s.reason === "km-per-show"));
  assert.ok(["Asheville", "Nashville"].every((n) => stops.some((s) => s.name === n)), "the top two stay");
  assert.ok(tradeOff && tradeOff.kmSaved > 500, tradeOff?.text);
  assert.match(tradeOff!.text, /^Dropping [A-Z].* for .* saves [\d,]+ km( and \d+ dark days?)?$/);
  assert.ok(pathKm(NASHVILLE, orderStops(NASHVILLE, stops)) < before);
});

test("a short run is clustered first: a regional run that keeps the #1 city", () => {
  const run = clusterCities(NASHVILLE, FAN, 8, { radius: 150 });
  assert.equal(run.length, 8);
  const names = run.map((s) => s.name);
  assert.ok(["Asheville", "Nashville"].every((n) => names.includes(n)), names.join(", "));
  const route = orderStops(NASHVILLE, run);
  assert.deepEqual(longLegs(NASHVILLE, route), []);
  const km = pathKm(NASHVILLE, route);
  assert.ok(km < 4500 && km / 8 < 600, `${km} km: ${route.map((s) => s.name).join(" > ")}`);
  for (const a of run) for (const b of run) if (a !== b) assert.ok(roadKm(a, b) > 0);
  // Every pick clears the radius (Knoxville is inside Asheville's, Louisville inside Lexington's).
  assert.ok(!names.includes("Knoxville") || !names.includes("Asheville"));
  // A must-play city is always in.
  assert.ok(clusterCities(NASHVILLE, FAN, 6, { radius: 150, must: [fan("Denver")] }).some((s) => s.name === "Denver"));
});

test("the trade-off reads the way a booker says it", () => {
  const after = FLAGSHIP.map((s) => (s.name === "Austin" ? fan("Memphis") : s.name === "Santa Fe" ? fan("Chattanooga") : s));
  const t = describeTradeOff(NASHVILLE, FLAGSHIP, after);
  assert.deepEqual(t.dropped.map((s) => s.name), ["Austin", "Santa Fe"]);
  assert.deepEqual(t.added.map((s) => s.name), ["Memphis", "Chattanooga"]);
  assert.equal(t.kmSaved, t.before.km - t.after.km);
  const km = Math.round(t.kmSaved / 100) * 100;
  const days = t.darkDaysSaved;
  assert.equal(t.text, `Dropping Austin and Santa Fe for Memphis and Chattanooga saves ${km.toLocaleString("en-US")} km${days > 0 ? ` and ${days} dark day${days === 1 ? "" : "s"}` : ""}`);
  assert.match(describeTradeOff(NASHVILLE, after, FLAGSHIP).text, /^Dropping Memphis and Chattanooga for Austin and Santa Fe adds [\d,]+ km/);
});

/* ───────────── water and borders ───────────── */

test("a ferry leg gets the sailing hours and a ferry flag; a road leg is unchanged", () => {
  const belfast = m("Belfast"), glasgow = m("Glasgow");
  const t = travel(belfast, glasgow);
  assert.match(t.ferry!.name, /North Channel/);
  assert.ok(driveHours(belfast, glasgow) > 4.5, `${driveHours(belfast, glasgow)} h`);
  // Bristol to Cork: a St George's Channel sailing plus about 5 h of road, not a 5.8 h drive.
  const bc = travel(m("Bristol"), m("Cork"));
  assert.match(bc.ferry!.name, /Rosslare/);
  assert.ok(bc.hours > 8.5, `${bc.hours} h`);
  // London to Paris: the Channel, and customs since Brexit.
  const lp = travel(m("London, UK"), m("Paris"));
  assert.match(lp.ferry!.name, /English Channel/);
  assert.equal(lp.borderH, 1);
  // Victoria is on Vancouver Island.
  assert.match(travel(m("Vancouver"), m("Victoria, BC")).ferry!.name, /BC Ferries/);
  // Helsinki to Stockholm is a Baltic sailing, never a drive across the sea.
  assert.match(travel(m("Helsinki"), m("Stockholm")).ferry!.name, /Baltic|Gulf of Finland/);
  assert.ok(travel(m("Helsinki"), m("Stockholm")).hours > 10);
  // Mainland legs are what they always were.
  const chi = m("Chicago"), den = m("Denver");
  assert.equal(travel(chi, den).ferry, undefined);
  assert.equal(legCost(chi, den), roadKm(chi, den));
  assert.equal(travel(chi, den).km, roadKm(chi, den));
});

test("Boston to Halifax goes round the Gulf of Maine", () => {
  const t = travel(m("Boston"), m("Halifax"));
  assert.ok(t.km > 950, `${t.km} km`);
  assert.equal(t.ferry, undefined);
  assert.ok(t.km > roadKm(m("Boston"), m("Halifax")));
});

test("the day sheet's legs carry the ferry", () => {
  const legs = schedule(m("Dublin"), [m("Dublin"), m("Belfast"), m("Glasgow"), m("Manchester, UK")], "2027-03-01");
  assert.equal(legs[1]!.ferry, undefined);
  assert.match(legs[2]!.ferry!.name, /Belfast–Cairnryan/);
  assert.ok(legs[2]!.fromHours > 4.5);
  assert.ok(legs[2]!.fromKm < roadKm(m("Belfast"), m("Glasgow")), "the sea miles aren't road");
});

test("a UK and Ireland run plays Ireland's dates together: one Irish Sea crossing", () => {
  const stops = ["Dublin", "Belfast", "Glasgow", "Manchester, UK", "London, UK", "Bristol", "Cork", "Leeds"].map((s, i) => city(s, i + 1));
  const legs = schedule(m("Dublin"), orderStops(m("Dublin"), stops), "2027-03-01");
  assert.equal(legs.filter((l) => l.ferry).length, 1, legs.map((l) => l.stop.name).join(" > "));
});

test("border hours and a border penalty keep a country's dates together", () => {
  assert.equal(borderHours(m("Toronto"), m("Chicago")), 1.5);
  assert.equal(borderHours(m("Dublin"), m("Belfast")), 0);
  assert.equal(borderHours(m("Berlin"), m("Paris")), 0);
  assert.equal(borderHours(m("Zurich"), m("Munich")), 1);
  // A stop with no country of its own is placed by its market's coordinates.
  assert.equal(countryOf({ lat: m("Montreal").lat, lon: m("Montreal").lon }), "CA");
  // Alvvays, from Toronto: the old order crossed the US/Canada border four times in eight stops.
  const from = m("Toronto");
  const stops = ["Toronto", "Chicago", "Philadelphia", "New York", "Ottawa", "Montreal", "Boston", "Halifax"].map((s, i) => city(s, i + 1));
  const route = orderStops(from, stops);
  const crossings = route.filter((s, i) => i > 0 && countryOf(s) !== countryOf(route[i - 1]!)).length;
  assert.ok(crossings <= 2, route.map((s) => s.name).join(" > "));
  assert.ok(legCost(m("Toronto"), m("Chicago")) > roadKm(m("Toronto"), m("Chicago")), "the border costs time");
});

/* ───────────── the hometown and the country cap ───────────── */

test("the starting city is played when it ranks in the artist's top 50", async () => {
  const from = m("Houston");
  const ranked = [city("Austin", 1), city("Dallas", 2), city("Denver", 3), city("New Orleans", 6), city("Oklahoma City", 9), city("Houston", 43)];
  assert.equal(homeCity(from, ranked)?.name, "Houston");
  assert.equal(homeCity(from, ranked.map((c) => (c.name === "Houston" ? { ...c, rank: 60 } : c))), null, "outside the top 50 it is a city like any other");
  const booked = ranked.slice(0, 5);
  const { stops, home, out, added } = await keepHome({ from, stops: booked, ranked, shows: 5, usable: yes });
  assert.equal(added, true);
  assert.equal(home?.name, "Houston");
  assert.equal(stops.length, 5);
  assert.ok(stops.some((s) => s.name === "Houston"));
  assert.deepEqual(out.map((s) => s.name), ["Oklahoma City"], "the weakest stop gives way");
  // Opened at home: pass it as the first stop.
  assert.equal(orderStops(from, stops, { first: home!.id })[0]!.name, "Houston");
  // Already on the tour: nothing changes.
  assert.equal((await keepHome({ from, stops, ranked, shows: 5, usable: yes })).added, false);
});

test("no country takes more than about 40% of a Europe run's dates", async () => {
  // Ghost from Stockholm: 6 of 8 dates in Germany and no Swedish date.
  const from = m("Stockholm");
  const ranked = [city("Stockholm", 1), city("Berlin", 2), city("Kassel", 3), city("Hamburg", 4), city("Munich", 5), city("Cologne", 6), city("Amsterdam", 7), city("Leipzig", 8), city("Copenhagen", 9), city("Paris", 10), city("Oslo", 11), city("Prague", 13)];
  const booked = ["Berlin", "Kassel", "Hamburg", "Munich", "Köln", "Leipzig", "Paris", "Prague"].map((n) => ranked.find((c) => c.name === n)!);
  assert.deepEqual(countryCheck(booked).over, [{ cc: "DE", n: 6, max: 3 }]);
  const { stops, swaps } = await capCountries({ from, stops: booked, pool: ranked, usable: yes, radius: 120 });
  assert.deepEqual(countryCheck(stops).over, []);
  assert.equal(stops.length, 8);
  assert.ok(swaps.every((s) => s.reason === "country" && countryOf(s.out) === "DE"));
  assert.ok(stops.some((s) => s.name === "Stockholm") && stops.some((s) => s.name === "Amsterdam"), stops.map((s) => s.name).join(", "));
  assert.ok(longLegs(from, orderStops(from, stops)).length === 0);
  assert.equal(MAX_LEG_KM, 1800);
});
