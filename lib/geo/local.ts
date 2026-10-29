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

/** With `focus`, the square frames the fans' core: the stronger half of the tiles within this distance of the hottest one. */
export const CORE_KM = 5;

/**
 * Projects tiles and places into a square of `size` px: a plate carrée scaled by cos(latitude), fitted to the
 * tiles' bounding box with a margin, so a city of any shape fills the square. Tile radius grows with strength.
 * With `focus` (the booked room, say), the square frames the fans' core instead: the stronger half of the tiles
 * within CORE_KM of the hottest one, plus the focus points near it, so a few far tiles don't shrink the
 * neighbourhood to a smudge; tiles outside that square are left off.
 */
export function localMap(tiles: LocalTile[], places: LocalPoint[], size = 180, opts: { focus?: LocalPoint[] } = {}): { dots: LocalMark[]; marks: { x: number; y: number }[]; scaleKm: number; /** The hottest tile in the square. */ hot?: { x: number; y: number }; /** Pixels per km, for rings drawn to scale. */ kmPx?: number } {
  if (!tiles.length) return { dots: [], marks: [], scaleKm: 0 };
  const hot = hotSpot(tiles)!;
  let frame: LocalPoint[] = tiles.map((t) => ({ lat: t[0], lon: t[1] }));
  let minSpan = 0.02;
  if (opts.focus) {
    const near = tiles.filter((t) => kmBetween(hot, { lat: t[0], lon: t[1] }) <= CORE_KM).sort((a, b) => b[2] - a[2]);
    const core = near.slice(0, Math.max(6, Math.ceil(near.length / 2)));
    frame = [hot, ...core.map((t) => ({ lat: t[0], lon: t[1] })), ...opts.focus.filter((p) => kmBetween(hot, p) <= CORE_KM * 1.6)];
    minSpan = 0.025;
  }
  const lats = frame.map((t) => t.lat), lons = frame.map((t) => t.lon);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  const spanLat = Math.max(...lats) - Math.min(...lats);
  const spanLon = (Math.max(...lons) - Math.min(...lons)) * cos;
  const span = Math.max(spanLat, spanLon, minSpan) * (opts.focus ? 1.25 : 1.12);
  const cLat = lat0, cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const xy = (p: LocalPoint) => ({ x: +(size / 2 + ((p.lon - cLon) * cos * size) / span).toFixed(1), y: +(size / 2 - ((p.lat - cLat) * size) / span).toFixed(1) });
  // Dots keep their look at any size: radii are set for the 180 px square and scale with it.
  const k = size / 180;
  const dots = tiles.map((t) => ({ ...xy({ lat: t[0], lon: t[1] }), r: +((1.4 + 4.2 * Math.sqrt(t[2])) * k).toFixed(1) })).filter((d) => d.x >= -d.r && d.x <= size + d.r && d.y >= -d.r && d.y <= size + d.r);
  // km across the whole square, for a scale line: one degree of latitude is 111 km.
  return { dots, marks: places.map(xy), scaleKm: +(span * 111).toFixed(1), hot: xy(hot), kmPx: +(size / (span * 111)).toFixed(3) };
}

/* ───────────── naming the hottest blocks, and whether the booked room is in them ───────────── */

/**
 * A Qloo place on the stop (a room, a poster shop, an after-show bar) with the neighbourhood Qloo files it under
 * (`properties.geocode.name`). Those names are Qloo's own localities: in Portland, 13 of 14 rooms' names matched
 * the locality polygon Qloo's heatmap returns around them (`output.heatmap.boundary=urn:entity:locality`, probed
 * Oct 25), so a vote over them names the hot tile in Qloo's words without another call per city.
 */
export type LocalPlace = { id?: string; name: string; lat?: number; lon?: number; area?: string; areaTrait?: string };

/** Places farther than this from the hottest tile don't vote on its name (the old 2 km reached across rivers). */
export const NAME_KM = 1;
/** The winning name needs at least this share of the weighted vote, or the area stays unnamed (a near split is no name). */
export const NAME_QUORUM = 0.6;
/** A name carried by a single place needs that place this close to the hottest tile. */
export const NAME_ONE_KM = 0.5;
/** The nearest place within this distance labels the hottest blocks when no neighbourhood is named. */
export const NEAR_KM = 0.6;

/** "Hosford-Abernethy" and "hosford abernethy", "William Wells Brown Neighborhood" and "William Wells Brown": one area. */
export function foldArea(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the |\bneighbou?rhood\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const placed = (p: LocalPlace): p is LocalPlace & LocalPoint => typeof p.lat === "number" && typeof p.lon === "number";

/** Each place once (a room can also come back as an after-show bar), by id, else by name. */
function uniquePlaces(places: LocalPlace[]): (LocalPlace & LocalPoint)[] {
  const seen = new Set<string>();
  return places.filter(placed).filter((p) => {
    const k = p.id ?? p.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The strength of the strongest tile within 0.25 km of a point (0 on a cold block). */
function heatAt(tiles: LocalTile[], p: LocalPoint): number {
  let s = 0;
  for (const t of tiles) if (kmBetween({ lat: t[0], lon: t[1] }, p) < 0.25) s = Math.max(s, t[2]);
  return s;
}

/**
 * Names the hottest tile by a vote of the Qloo places around it: each place within NAME_KM votes for the area
 * Qloo files it under, nearer places and places on hotter tiles counting more (a place filed under the city
 * alone abstains). The winner needs NAME_QUORUM of the weight and either two places or one within
 * NAME_ONE_KM; otherwise the area stays unnamed rather than guessed.
 */
export function nameHot(tiles: LocalTile[], places: LocalPlace[]): { name?: string; trait?: string; votes: number; voters: number } {
  const hot = hotSpot(tiles);
  if (!hot) return { votes: 0, voters: 0 };
  const votes = new Map<string, { name: string; w: number; n: number; nearest: number; traits: Map<string, number> }>();
  let total = 0;
  let voters = 0;
  for (const p of uniquePlaces(places)) {
    const d = kmBetween(hot, p);
    const area = p.area?.trim();
    if (d > NAME_KM || !area) continue;
    const w = (0.5 + 0.5 * heatAt(tiles, p)) / (0.2 + d) ** 2;
    total += w;
    voters++;
    const k = foldArea(area);
    const v = votes.get(k) ?? { name: area, w: 0, n: 0, nearest: Infinity, traits: new Map<string, number>() };
    v.w += w;
    v.n++;
    v.nearest = Math.min(v.nearest, d);
    if (p.areaTrait) v.traits.set(p.areaTrait, (v.traits.get(p.areaTrait) ?? 0) + 1);
    votes.set(k, v);
  }
  const best = [...votes.values()].sort((a, b) => b.w - a.w)[0];
  if (!best || best.w < NAME_QUORUM * total || (best.n < 2 && best.nearest > NAME_ONE_KM)) return { votes: best?.n ?? 0, voters };
  const trait = [...best.traits.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { name: best.name, ...(trait ? { trait } : {}), votes: best.n, voters };
}

/**
 * The hottest tile as a stop stores it. `named: "near"` marks a name (or its absence) settled at run time by a
 * vote of the Qloo places within NEAR_VOTE_M of the tile (lib/agent/local.ts, from Oct 25): that vote saw more
 * places than the stop keeps, so it stands. A tour saved before it has no mark, and its stored name (from a
 * majority of places within 2 km, which reached across rivers) is re-derived from the stop's own places instead.
 */
export type HotName = { lat: number; lon: number; name?: string; trait?: string; named?: "near" };

/** The radius of the run-time vote around the hottest tile (one Qloo places call per city). */
export const NEAR_VOTE_M = 600;

/** What the day sheet and the pitch may say about a stop at street level, all from the stored tiles and places. */
export type LocalRead = {
  /** The neighbourhood of the fans' hottest blocks, by the vote; absent when Qloo's places there don't say. */
  area?: string;
  /** How Qloo characterises that neighbourhood ("Creative hub"), from the places filed under it. */
  trait?: string;
  /** The nearest Qloo place to the hottest blocks (within NEAR_KM), to point at when no neighbourhood is named. */
  near?: { name: string; km: number };
  /** The booked room against the hottest blocks. `sitsIn` only when Qloo files the room under the fans' area. */
  room?: { name: string; area?: string; km: number; inHot: boolean; sitsIn: boolean };
};

/**
 * Reads a stop's street level from what it stores (tiles, hot tile, rooms, poster shops, bars), so a tour saved
 * before this rule reads right without re-running: the hot area's name is the run-time vote's when the stop has
 * one (HotName), else a vote of the stop's own places; the room's area is its own Qloo place's; and "sits in"
 * needs the two to match.
 */
export function readLocal(local: { tiles: LocalTile[]; hot?: HotName }, room: LocalPlace | undefined, places: LocalPlace[]): LocalRead {
  const all = room ? [room, ...places] : places;
  const named = local.hot?.named === "near" ? { name: local.hot.name, trait: local.hot.trait } : nameHot(local.tiles, all);
  const out: LocalRead = { ...(named.name ? { area: named.name } : {}), ...(named.trait ? { trait: named.trait } : {}) };
  const hot = hotSpot(local.tiles);
  if (hot) {
    const near = uniquePlaces(all)
      .map((p) => ({ name: p.name, km: +kmBetween(hot, p).toFixed(1) }))
      .filter((p) => p.km <= NEAR_KM)
      .sort((a, b) => a.km - b.km)[0];
    if (near) out.near = near;
  }
  if (room && placed(room)) {
    const h = placeHeat(local.tiles, room);
    if (h) {
      const area = room.area?.trim() || undefined;
      out.room = { name: room.name, ...(area ? { area } : {}), km: h.km, inHot: h.inHot, sitsIn: !!(area && named.name && foldArea(area) === foldArea(named.name)) };
    }
  }
  return out;
}

const kmFrom = (km: number) => (km < 0.1 ? "under 100 m from" : `${km} km from`);

/**
 * The day sheet's words: `lead` + `name` (bold, only ever a real neighbourhood) + `tail`, then `verdict` on the
 * room. With no name the lead says so plainly and points at the nearest Qloo place instead.
 */
export function localWords(r: LocalRead, city: string, who = "fans"): { lead: string; name?: string; tail: string; verdict: string } {
  const head = `Inside ${city}, ${who} over-index most`;
  const words = r.area
    ? { lead: `${head} around `, name: `${r.area}${r.trait ? ` (${r.trait.toLowerCase()})` : ""}`, tail: "." }
    : r.near && r.near.name !== r.room?.name
      ? { lead: `${head} in the blocks around ${r.near.name}; Qloo names no neighbourhood there.`, tail: "" }
      : { lead: `${head} in one cluster of blocks; Qloo names no neighbourhood there.`, tail: "" };
  return { ...words, verdict: roomVerdict(r) };
}

/** "Dante's sits in Downtown, 0.6 km from the hottest blocks." or "Roseland is 1.9 km from the fans' hottest blocks (Buckman); Qloo files it under Old Town." */
export function roomVerdict(r: LocalRead): string {
  const m = r.room;
  if (!m) return "";
  if (m.sitsIn) return `${m.name} sits in ${r.area}, ${kmFrom(m.km)} the hottest blocks.`;
  const strong = m.inHot && m.km > HOT_KM ? ", on one of their strongest tiles" : "";
  const filed = m.area ? `; Qloo files it under ${m.area}` : "";
  return `${m.name} is ${kmFrom(m.km)} the fans' hottest blocks${r.area ? ` (${r.area})` : ""}${strong}${filed}.`;
}

/**
 * The pitch's evidence line for the same facts, with the rule a writer must keep: say the room is in the fans'
 * neighbourhood only when Qloo files the room there.
 */
export function localEvidence(r: LocalRead, city: string, artist: string): string {
  const where = r.area ? `around ${r.area}${r.trait ? `, ${r.trait.toLowerCase()}` : ""}` : r.near ? `in the blocks around ${r.near.name} (Qloo names no neighbourhood there)` : "in one cluster of blocks (Qloo names no neighbourhood there)";
  const lead = `Qloo's street-level heatmap puts ${artist} fans' strongest area in ${city} ${where}`;
  const m = r.room;
  if (!m) return `${lead}.`;
  if (m.sitsIn) return `${lead}; ${m.name} sits in ${r.area}, ${kmFrom(m.km)} the hottest blocks.`;
  const strong = m.inHot && m.km > HOT_KM ? ", on one of the fans' strongest tiles" : "";
  const filed = m.area ? ` Qloo files ${m.name} under ${m.area}.` : "";
  const rule = r.area ? ` Do not write that ${m.name} is in ${r.area}.` : " Name no neighbourhood for the fans.";
  return `${lead}; ${m.name} is ${kmFrom(m.km)} those blocks${strong}.${filed}${rule}`;
}
