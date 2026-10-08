/**
 * Inside one city: Qloo's heatmap at street level (geohash-7 tiles, about 150 m across) says which neighbourhoods
 * an artist's fans over-index in. These helpers are pure (no server, no Qloo) so the day sheet can draw the map
 * in the browser and the rules can be tested: which tile is hottest, how far the booked room is from it, and a
 * square projection of tiles and places for the small map.
 */

/** A tile as kept on a stop: latitude, longitude, strength (affinity × popularity, 0–1 within this city). */
export type LocalTile = [lat: number, lon: number, strength: number];

export type LocalPoint = { lat: number; lon: number };

/** Within this distance of the hottest tile a room is "in the fans' neighbourhood". */
export const HOT_KM = 1.5;

/** Great-circle distance in km (duplicated from markets.ts so the client bundle doesn't carry the city list). */
export function kmBetween(a: LocalPoint, b: LocalPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * Turns raw tiles into the stop's local tiles: strength is affinity × popularity (Playbook N2: affinity alone is a
 * rank that saturates at 0.99), stretched to 0–1 within the city, and only the strongest `keep` tiles are kept so a
 * stop stays a few KB.
 */
export function localTiles(raw: { lat: number; lon: number; affinity: number; popularity?: number }[], keep = 160): LocalTile[] {
  const s = raw.map((t) => t.affinity * (t.popularity ?? 1));
  const lo = Math.min(...s), hi = Math.max(...s);
  return raw
    .map((t, i): LocalTile => [+t.lat.toFixed(4), +t.lon.toFixed(4), hi > lo ? +((s[i]! - lo) / (hi - lo)).toFixed(3) : 1])
    .sort((a, b) => b[2] - a[2])
    .slice(0, keep);
}

/** The hottest tile: the centre of the neighbourhood where fans over-index most. */
export function hotSpot(tiles: LocalTile[]): LocalPoint | null {
  if (!tiles.length) return null;
  const t = tiles.reduce((a, b) => (b[2] > a[2] ? b : a));
  return { lat: t[0], lon: t[1] };
}

/**
 * How a place sits against the fans' strongest area: inside it when within HOT_KM of the hottest tile, or when
 * the place's own tile is in the top tenth of the city's strength.
 */
export function placeHeat(tiles: LocalTile[], place: LocalPoint): { km: number; inHot: boolean; strength: number } | null {
  const hot = hotSpot(tiles);
  if (!hot) return null;
  const km = +kmBetween(hot, place).toFixed(1);
  let strength = 0;
  for (const t of tiles) if (kmBetween({ lat: t[0], lon: t[1] }, place) < 0.35) strength = Math.max(strength, t[2]);
  return { km, inHot: km <= HOT_KM || strength >= 0.9, strength };
}

export type LocalMark = { x: number; y: number; r: number };

/**
 * Projects tiles and places into a square of `size` px: a plate carrée scaled by cos(latitude), fitted to the
 * tiles' bounding box with a margin, so a city of any shape fills the square. Tile radius grows with strength.
 */
export function localMap(tiles: LocalTile[], places: LocalPoint[], size = 180): { dots: LocalMark[]; marks: { x: number; y: number }[]; scaleKm: number } {
  if (!tiles.length) return { dots: [], marks: [], scaleKm: 0 };
  const lats = tiles.map((t) => t[0]), lons = tiles.map((t) => t[1]);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  const spanLat = Math.max(...lats) - Math.min(...lats);
  const spanLon = (Math.max(...lons) - Math.min(...lons)) * cos;
  const span = Math.max(spanLat, spanLon, 0.02) * 1.12;
  const cLat = lat0, cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const xy = (p: LocalPoint) => ({ x: +(size / 2 + ((p.lon - cLon) * cos * size) / span).toFixed(1), y: +(size / 2 - ((p.lat - cLat) * size) / span).toFixed(1) });
  const dots = tiles.map((t) => ({ ...xy({ lat: t[0], lon: t[1] }), r: +(1.4 + 4.2 * Math.sqrt(t[2])).toFixed(1) }));
  // km across the whole square, for a scale line: one degree of latitude is 111 km.
  return { dots, marks: places.map(xy), scaleKm: +(span * 111).toFixed(1) };
}
