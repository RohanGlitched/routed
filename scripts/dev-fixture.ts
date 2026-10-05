// LOCAL DESIGN FIXTURE ONLY: writes a sample finished tour to .data/tours/ (gitignored, never deployed) so the
// pages can be laid out before live Qloo data exists. Every number in it is made up. Usage: npx tsx scripts/dev-fixture.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { findMarket, marketId, marketLabel } from "../lib/geo/markets.ts";
import { orderStops, schedule } from "../lib/geo/route.ts";
import { templatePitch } from "../lib/agent/evidence.ts";
import { doorAdvice } from "../lib/agent/audience.ts";
import type { Plan, Stop, TourRecord, CityScore } from "../lib/types.ts";

const names = ["Seattle", "Portland, OR", "Chicago", "New York", "Boston", "Washington DC", "Minneapolis", "Denver", "Pittsburgh", "Toronto", "Los Angeles", "San Francisco", "Austin", "Atlanta"];
const rooms: Record<string, string[]> = {
  Seattle: ["Neumos", "The Showbox", "Crocodile"], Portland: ["Crystal Ballroom", "Wonder Ballroom", "Doug Fir Lounge"], Chicago: ["Thalia Hall", "Metro", "Empty Bottle"],
  "New York": ["Brooklyn Steel", "Webster Hall", "Bowery Ballroom"], Boston: ["Royale", "Paradise Rock Club", "Roadrunner"], Washington: ["9:30 Club", "Black Cat", "The Atlantis"],
  Minneapolis: ["First Avenue", "Fine Line", "Turf Club"], Denver: ["Ogden Theatre", "Bluebird Theater", "Gothic Theatre"], Pittsburgh: ["Roxian Theatre", "Mr. Smalls", "Thunderbird"],
  Toronto: ["The Danforth Music Hall", "Lee's Palace", "Opera House"], "Los Angeles": ["The Wiltern", "The Fonda", "Teragram Ballroom"], "San Francisco": ["The Fillmore", "Great American Music Hall", "The Independent"],
  Austin: ["Mohawk", "Scoot Inn", "Emo's"], Atlanta: ["Variety Playhouse", "Terminal West", "The Masquerade"],
};
const openers = ["Jay Som", "Hand Habits", "Hovvdy", "Snail Mail", "Indigo De Souza", "Lomelda", "Alex G", "Soccer Mommy", "Frankie Cosmos", "Ratboys"];
const cities: CityScore[] = names.map((n, i) => {
  const m = findMarket(n)!;
  return { marketId: marketId(m), name: m.name, label: marketLabel(m), lat: m.lat, lon: m.lon, affinity: +(0.96 - i * 0.031).toFixed(3), popularity: +(0.9 - i * 0.02).toFixed(3), tiles: 3 + (i % 4), rank: i + 1 };
});
const home = findMarket("Philadelphia")!;
const from = { marketId: marketId(home), label: marketLabel(home), lat: home.lat, lon: home.lon };
const chosen = cities.slice(0, 10);
const legs = schedule(from, orderStops(from, chosen), "2027-03-12");
const heat = cities.flatMap((c) => [0, 1, 2].map((k) => ({ lat: c.lat + (k - 1) * 0.12, lon: c.lon + (k - 1) * 0.15, affinity: c.affinity - k * 0.05, popularity: c.popularity })));
const audience: Plan["audience"] = {
  age: { "24_and_younger": 0.18, "25_to_29": 0.31, "30_to_34": 0.12, "35_to_44": -0.08, "45_to_54": -0.21, "55_and_older": -0.3 },
  gender: { female: 0.12, male: -0.12 },
  tags: ["Indie pop", "Dream pop", "Bedroom pop", "Shoegaze", "Lo-fi", "Art pop"].map((n, i) => ({ id: `t${i}`, name: n, affinity: 0.9 - i * 0.05 })),
  trend: Array.from({ length: 26 }, (_, i) => ({ date: new Date(Date.UTC(2026, 3, 6 + i * 7)).toISOString().slice(0, 10), percentile: 78 + Math.sin(i / 3) * 4 + i * 0.35 })),
  brands: ["Patagonia", "Aesop", "Le Labo", "Arc'teryx", "Glossier", "Muji"].map((n, i) => ({ id: `b${i}`, name: n })),
};
audience.advice = doorAdvice(audience.age);
const stops: Stop[] = legs.map((l, i) => {
  const key = l.stop.name;
  const rs = (rooms[key] ?? ["Room A", "Room B", "Room C"]).map((n, k) => ({ id: `${l.stop.marketId}-r${k}`, name: n, address: `${l.stop.name}`, affinity: +(0.93 - k * 0.07).toFixed(2), popularity: 0.8, tags: ["Music venue"], ...(k === 0 ? { capacity: { value: [700, 1000, 800, 1800, 1200, 1200, 1550, 1600, 1000, 1400][i] ?? 900, source: "https://en.wikipedia.org/", quote: "sample" } } : {}) }));
  const os = [0, 1, 2].map((k) => ({ id: `o${(i + k) % openers.length}`, name: openers[(i + k) % openers.length]!, affinity: +(0.88 - k * 0.06).toFixed(2), shared: ["Indie pop", "Lo-fi"] }));
  return { marketId: l.stop.marketId, city: l.stop.name, label: l.stop.label, lat: l.stop.lat, lon: l.stop.lon, date: l.date, fromKm: l.fromKm, fromHours: l.fromHours, travelDays: l.travelDays, dayOff: l.dayOff, score: l.stop, why: `Ranks ${l.stop.rank} for fan affinity, and ${rs[0]!.name} is where these fans already go.`, rooms: rs, roomId: rs[0]!.id, openers: os, openerId: os[0]!.id, after: [{ id: "a1", name: "Sample Bar" }, { id: "a2", name: "Sample Tavern" }] };
});
const plan: Plan = { artist: { id: "fixture", name: "Japanese Breakfast", genres: ["Indie pop", "Dream pop"], popularity: 0.86 }, region: "na", from, firstDate: "2027-03-12", lastDate: legs.at(-1)!.date, heat, cities, stops, totalKm: legs.reduce((s, l) => s + l.fromKm, 0), audience };
for (const s of plan.stops) s.pitch = { ...templatePitch(plan, s), struck: [] };
const log: TourRecord["log"] = [
  { at: "2026-10-05T12:00:00.000Z", kind: "qloo", text: "Who is “Japanese Breakfast” on Qloo?", result: "Japanese Breakfast", request: "/search?query=Japanese Breakfast&types=urn:entity:artist&take=5", ms: 212 },
  { at: "2026-10-05T12:00:01.000Z", kind: "qloo", text: "Where do Japanese Breakfast fans over-index in United States?", result: "50 heatmap tiles", request: "/v2/insights?filter.type=urn:heatmap&signal.interests.entities=…&filter.location.query=United States&take=50", ms: 640 },
  { at: "2026-10-05T12:00:02.000Z", kind: "rule", text: "Heatmap tiles placed in their cities.", result: "14 cities; strongest: Seattle, Portland, Chicago, New York" },
  { at: "2026-10-05T12:00:05.000Z", kind: "model", text: "The agent picked 10 cities.", result: chosen.map((c) => c.name).join(", ") },
];
const rec: TourRecord = { id: "devfixture", createdAt: "2026-10-05T12:00:00.000Z", status: "done", input: { artist: "Japanese Breakfast", from: "Philadelphia", firstDate: "2027-03-12", shows: 10 }, log, plan, engine: { planned: "model", agent: "Nemotron 3 Ultra", writer: "Nemotron 3 Ultra" }, showcase: true, finishedAt: "2026-10-05T12:01:00.000Z" };
mkdirSync(".data/tours", { recursive: true });
writeFileSync(".data/tours/devfixture.json", JSON.stringify(rec, null, 2));
console.log("wrote .data/tours/devfixture.json", stops.map((s) => `${s.date} ${s.city}`).join(", "));
