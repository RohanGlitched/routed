// Builds lib/geo/masks.json: for each region, the halftone grid points that fall on land (Natural Earth 50m via
// world-atlas). Slow (about a minute per region), so it runs once, not per request. Usage: npx tsx scripts/build-masks.ts
import { writeFileSync } from "node:fs";
import { geoContains } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import land50 from "world-atlas/land-50m.json" with { type: "json" };
import { BOXES, MAP_H, MAP_W, STEP, projection } from "../lib/geo/map.ts";

const topo = land50 as unknown as Topology;
const land = feature(topo, topo.objects.land!);
const out: Record<string, [number, number, number, number][]> = {};
for (const region of ["na", "uk", "eu"] as const) {
  const t = Date.now();
  const proj = projection(region);
  const b = BOXES[region];
  const pts: [number, number, number, number][] = [];
  for (let row = 0, y = STEP / 2; y < MAP_H; y += STEP * 0.866, row++) {
    for (let x = (row % 2 ? STEP / 2 : 0) + STEP / 2; x < MAP_W; x += STEP) {
      const ll = proj.invert?.([x, y]);
      if (!ll) continue;
      const [lon, lat] = ll;
      if (lon < b.lon[0] - 2 || lon > b.lon[1] + 2 || lat < b.lat[0] - 1 || lat > b.lat[1] + 1) continue;
      if (geoContains(land as never, ll)) pts.push([+x.toFixed(1), +y.toFixed(1), +lat.toFixed(3), +lon.toFixed(3)]);
    }
  }
  out[region] = pts;
  console.log(region, pts.length, "points", Date.now() - t, "ms");
}
writeFileSync(new URL("../lib/geo/masks.json", import.meta.url), JSON.stringify(out));
