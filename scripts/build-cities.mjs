// Builds lib/geo/cities.json, the touring markets a heatmap tile can be named after, from GeoNames
// (CC BY 4.0, https://www.geonames.org). Usage: node scripts/build-cities.mjs <cities15000.txt> <admin1CodesASCII.txt>
//
// A market is a city of 50k+ (North America, UK and Ireland) or 100k+ (rest of Europe). A smaller city within
// 30 km of a bigger one is a suburb of it (Brooklyn, Jersey City and Newark all play as New York).
import { readFileSync, writeFileSync } from "node:fs";

const [citiesPath, adminPath] = process.argv.slice(2);
if (!citiesPath || !adminPath) throw new Error("usage: node scripts/build-cities.mjs <cities15000.txt> <admin1CodesASCII.txt>");

const NA = new Set(["US", "CA"]);
const UKI = new Set(["GB", "IE"]);
const EU = new Set(["DE", "FR", "NL", "BE", "LU", "ES", "PT", "IT", "CH", "AT", "DK", "SE", "NO", "FI", "PL", "CZ", "HU", "SK", "SI", "HR", "IS", "EE", "LV", "LT", "GR", "RO", "BG", "RS"]);
const region = (cc) => (NA.has(cc) ? "na" : UKI.has(cc) ? "uk" : EU.has(cc) ? "eu" : null);

const admin = new Map(
  readFileSync(adminPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .map(([code, name, ascii]) => [code, ascii || name]),
);

const rows = [];
for (const line of readFileSync(citiesPath, "utf8").split("\n")) {
  if (!line) continue;
  const f = line.split("\t");
  const [, name, ascii, , lat, lon, fclass, fcode, cc, , a1] = f;
  const pop = Number(f[14]);
  const r = region(cc);
  if (!r || fclass !== "P" || fcode === "PPLX" || fcode === "PPLH") continue;
  if (pop < (r === "eu" ? 100_000 : 50_000)) continue;
  // US states are two-letter codes already; elsewhere use the region's name (Ontario, England, Bavaria).
  const state = cc === "US" ? a1 : admin.get(`${cc}.${a1}`) ?? "";
  rows.push({ name, ascii, lat: Number(lat), lon: Number(lon), cc, state, pop, r });
}

const km = (a, b) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

rows.sort((a, b) => b.pop - a.pop);
const markets = [];
for (const c of rows) if (!markets.some((m) => km(m, c) < 30)) markets.push(c);

// Display names a booking agent would use.
const RENAME = { "New York City": "New York" };
const out = markets.map((m) => [RENAME[m.name] ?? m.name, m.ascii, m.cc, m.state, +m.lat.toFixed(4), +m.lon.toFixed(4), m.pop, m.r]);
writeFileSync(new URL("../lib/geo/cities.json", import.meta.url), JSON.stringify(out));
const by = (r) => out.filter((m) => m[7] === r).length;
console.log(`${out.length} markets (na ${by("na")}, uk ${by("uk")}, eu ${by("eu")}) from ${rows.length} cities`);
console.log(out.slice(0, 12).map((m) => m[0]).join(", "));
