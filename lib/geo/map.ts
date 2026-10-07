import { geoConicConformal, type GeoProjection } from "d3-geo";
import type { Feature, Polygon } from "geojson";
import masksJson from "./masks.json";
import type { RegionId } from "./markets";

// Kept local (not imported from markets.ts) so the client bundle doesn't carry the city list.
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * The poster's map: the region's land as a halftone grid (like a screen-printed plate), each dot sized by how
 * strongly the artist's fans over-index nearby on Qloo's heatmap. The land mask (which grid points are land)
 * is computed once by scripts/build-masks.ts into masks.json, because a spherical point-in-coastline test takes
 * ~50 s per region; at request time only the dot sizes change.
 */
export const MAP_W = 540;
export const MAP_H = 250;
export const STEP = 7.2;

type Box = { lon: [number, number]; lat: [number, number]; parallels: [number, number]; rotate: number };

export const BOXES: Record<RegionId, Box> = {
  na: { lon: [-125, -64], lat: [25, 50.5], parallels: [33, 45], rotate: 96 },
  uk: { lon: [-10.6, 1.9], lat: [50, 58.8], parallels: [51, 57], rotate: 4 },
  eu: { lon: [-10, 28], lat: [36, 61], parallels: [43, 57], rotate: -10 },
};

export function projection(region: RegionId): GeoProjection {
  const b = BOXES[region];
  const outline: Feature<Polygon> = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[[b.lon[0], b.lat[0]], [b.lon[1], b.lat[0]], [b.lon[1], b.lat[1]], [b.lon[0], b.lat[1]], [b.lon[0], b.lat[0]]].reverse() as [number, number][]],
    },
  };
  return geoConicConformal().parallels(b.parallels).rotate([b.rotate, 0]).fitExtent([[6, 6], [MAP_W - 6, MAP_H - 6]], outline);
}

type MaskPoint = { x: number; y: number; lat: number; lon: number };
const MASKS = masksJson as unknown as Record<RegionId, [number, number, number, number][]>;
const masks = new Map<RegionId, { proj: GeoProjection; points: MaskPoint[] }>();

function mask(region: RegionId) {
  const hit = masks.get(region);
  if (hit) return hit;
  const m = { proj: projection(region), points: MASKS[region].map(([x, y, lat, lon]) => ({ x, y, lat, lon })) };
  masks.set(region, m);
  return m;
}

export type Dot = [x: number, y: number, r: number];

export type PosterMap = {
  dots: Dot[];
  /** Projected positions of the stops, in route order. */
  route: [number, number][];
  /** Projected starting city. */
  start: [number, number] | null;
};

/**
 * Dot radius: a floor so the land reads, plus heat from nearby tiles (falling off over ~130 km). A tile's heat is
 * its strength (affinity × popularity) stretched between the weakest and strongest tiles kept, squared, so the
 * hot spots stand out instead of the whole map reading 0.9. Normalised to the hottest dot on this map, so every
 * poster uses the full range of the screen.
 */
export function posterMap(region: RegionId, heat: { lat: number; lon: number; affinity: number; popularity?: number }[], stops: { lat: number; lon: number }[], start?: { lat: number; lon: number }): PosterMap {
  const { proj, points } = mask(region);
  const strength = heat.map((t) => t.affinity * (t.popularity ?? 1));
  const lo = Math.min(...strength), hi = Math.max(...strength);
  const tiles = heat.map((t, i) => ({ lat: t.lat, lon: t.lon, w: hi > lo ? ((strength[i]! - lo) / (hi - lo)) ** 2 : 1 }));
  const raw = points.map((p) => {
    let h = 0;
    for (const t of tiles) {
      if (t.w < 0.02) continue;
      const d = km(p, t);
      if (d < 420) h = Math.max(h, t.w * Math.exp(-((d / 130) ** 2)));
    }
    return h;
  });
  const top = Math.max(0.0001, ...raw);
  const dots: Dot[] = points.map((p, i) => [p.x, p.y, +(1.05 + 2.65 * Math.sqrt(raw[i]! / top)).toFixed(2)]);
  const xy = (s: { lat: number; lon: number }) => {
    const v = proj([s.lon, s.lat]);
    return v ? ([+v[0].toFixed(1), +v[1].toFixed(1)] as [number, number]) : null;
  };
  return { dots, route: stops.map(xy).filter((v): v is [number, number] => Boolean(v)), start: start ? xy(start) : null };
}
