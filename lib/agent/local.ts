import "server-only";
import { hotSpot, localTiles, localWords, nameHot, NEAR_VOTE_M, readLocal, type HotName, type LocalPlace, type LocalPoint, type LocalTile } from "../geo/local";
import { marketById } from "../geo/markets";
import { describeRequest, recommend, sharedTastes, wherePopular } from "../qloo";
import type { Artist, Local, Opener, Room, Spot } from "../types";
import { cityArea, type Log } from "./tools";

/**
 * Inside each booked city, from Qloo: the street-level heatmap (which neighbourhood the fans over-index in) and
 * what the headliner's and the opener's audiences share. Both are Qloo's rankings; nothing here is written by
 * the model.
 */

/**
 * The city's heatmap at street level: a few hundred tiles about 150 m across, strongest kept; then one more call
 * names the hottest tile, from the neighbourhoods Qloo files the places around it under.
 */
export async function lookUpLocal(artist: Artist, marketId: string, log: Log): Promise<Local | null> {
  const m = marketById(marketId);
  if (!m) return null;
  const t = Date.now();
  try {
    const r = await wherePopular(artist.id, cityArea(m), 50);
    const tiles = localTiles(r.tiles);
    const hot = hotSpot(tiles);
    if (!hot) {
      log({ kind: "qloo", text: `Where inside ${m.name} do ${artist.name} fans over-index, street by street?`, result: "No tiles came back for the city.", request: describeRequest(r.request), ms: Date.now() - t });
      return null;
    }
    log({ kind: "qloo", text: `Where inside ${m.name} do ${artist.name} fans over-index, street by street?`, result: `${r.tiles.length} tiles about 150 m across`, request: describeRequest(r.request), ms: Date.now() - t });
    return { tiles, hot: await nameNear(artist, tiles, hot, m.name, log) };
  } catch (e) {
    log({ kind: "qloo", text: `Where inside ${m.name} do ${artist.name} fans over-index, street by street?`, result: (e as Error).message, failed: true });
    return null;
  }
}

/**
 * One Qloo call per city (cached with every other GET): the places these fans go to within NEAR_VOTE_M of the
 * hottest tile, each filed by Qloo under a neighbourhood, vote on its name (lib/geo/local.ts nameHot). The
 * locality heatmap (`output.heatmap.boundary=urn:entity:locality`) names it too, but answers 5–6 MB per city
 * with every state and country polygon and has no neighbourhoods at all for cities like Nashville (probed Oct 25).
 * If the call fails the tile keeps no mark, and the stop's own places name it later.
 */
async function nameNear(artist: Artist, tiles: LocalTile[], hot: LocalPoint, city: string, log: Log): Promise<HotName> {
  const t = Date.now();
  const text = `Which neighbourhood holds ${city}'s hottest blocks?`;
  try {
    const r = await recommend({ type: "urn:entity:place", signals: [artist.id], near: { ...hot, radiusM: NEAR_VOTE_M }, take: 25 });
    const places: LocalPlace[] = r.entities.map((e) => ({ id: e.id, name: e.name, lat: e.place?.lat, lon: e.place?.lon, area: e.place?.area, areaTrait: e.tags.find((x) => x.id.startsWith("urn:tag:neighborhood_characteristic:"))?.name }));
    const v = nameHot(tiles, places);
    log({ kind: "qloo", text, result: v.name ? `${v.name}: ${v.votes} of the ${v.voters} places nearby with a neighbourhood are filed there` : v.voters ? `No one name: ${v.voters} places nearby, split across neighbourhoods` : `Qloo files no place nearby under a neighbourhood (${places.length} places)`, request: describeRequest(r.request), ms: Date.now() - t });
    return { ...hot, ...(v.name ? { name: v.name } : {}), ...(v.trait ? { trait: v.trait } : {}), named: "near" };
  } catch (e) {
    log({ kind: "qloo", text, result: (e as Error).message, failed: true });
    return hot;
  }
}

/**
 * Settles the hot neighbourhood's name (the run-time vote's, else a vote of the stop's own places) and measures
 * the booked room against it. "Sits in" is said only when Qloo files the room under that same neighbourhood.
 */
export function placeLocal(local: Local, room: Room | undefined, nearby: Spot[], city: string, log: Log, rooms: Room[] = []): Local {
  const read = readLocal(local, room, [...nearby, ...rooms]);
  const hot: HotName = local.hot;
  // The mark rides along untyped until Local.hot declares it (lib/geo/local.ts HotName).
  const out: Local = { ...local, hot: { lat: hot.lat, lon: hot.lon, ...(hot.named ? { named: hot.named } : {}), ...(read.area ? { name: read.area } : {}), ...(read.trait ? { trait: read.trait } : {}) } };
  if (read.room) {
    out.roomKm = read.room.km;
    out.inHot = read.room.inHot;
    log({ kind: "rule", text: `Is ${read.room.name} where ${city}'s fans are?`, result: localWords(read, city).verdict });
  }
  return out;
}

/** The tag kinds worth a word in a pitch, best first: style, genre and mood. Audience and theme tags ("Engaging",
 *  "Love", "Passionate") came back for nearly every pair, so they say nothing about this one. */
const SHARED_KINDS = ["urn:tag:style:qloo", "urn:tag:genre:music", "urn:tag:music:qloo", "urn:tag:artist:qloo"];
/** Words every audience shares, which say nothing about this pair. */
const BLAND = /^(straightforward|simple chord progressions|moderate|melodic|simple|steady|electric|acoustic|drums|guitar|vocals|engaging|love|passionate|loyal|energetic|emotional|catchy|dynamic|expressive|intimate|upbeat|fun|powerful|authentic|relatable|engaged|devoted|enthusiastic|dedicated)$/i;

/** What the headliner's fans and an opener's fans share, from Qloo's audience comparison, as three plain words. */
export async function lookUpShared(artist: Artist, opener: Opener, log: Log): Promise<string[]> {
  const t = Date.now();
  try {
    const r = await sharedTastes(artist.id, opener.id, 40);
    // One word from each kind in turn (style, theme, audience, mood, genre), so a pair reads "Intimate,
    // Heartache, Passionate" rather than three words of the same kind.
    const picked: string[] = [];
    const byKind = SHARED_KINDS.map((kind) => r.tags.filter((x) => x.type === kind && !BLAND.test(x.name.trim())).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)));
    for (let round = 0; round < 3 && picked.length < 3; round++) {
      for (const list of byKind) {
        const tag = list[round];
        const name = tag?.name.trim();
        if (!name || picked.some((p) => p.toLowerCase() === name.toLowerCase())) continue;
        picked.push(name);
        if (picked.length >= 3) break;
      }
    }
    log({ kind: "qloo", text: `What do ${artist.name} fans and ${opener.name} fans share?`, result: picked.length ? picked.join(", ") : "Nothing in common came back.", request: describeRequest(r.request), ms: Date.now() - t });
    return picked;
  } catch (e) {
    log({ kind: "qloo", text: `What do ${artist.name} fans and ${opener.name} fans share?`, result: (e as Error).message, failed: true });
    return [];
  }
}

export type { LocalTile };
