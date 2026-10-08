import "server-only";
import { HOT_KM, hotSpot, localTiles, placeHeat, type LocalTile } from "../geo/local";
import { marketById } from "../geo/markets";
import { describeRequest, sharedTastes, wherePopular } from "../qloo";
import type { Artist, Local, Opener, Room, Spot } from "../types";
import { cityArea, type Log } from "./tools";

/**
 * Inside each booked city, from Qloo: the street-level heatmap (which neighbourhood the fans over-index in) and
 * what the headliner's and the opener's audiences share. Both are Qloo's rankings; nothing here is written by
 * the model.
 */

/** The city's heatmap at street level: a few hundred tiles about 150 m across, strongest kept. */
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
    return { tiles, hot };
  } catch (e) {
    log({ kind: "qloo", text: `Where inside ${m.name} do ${artist.name} fans over-index, street by street?`, result: (e as Error).message, failed: true });
    return null;
  }
}

/** Names the hot neighbourhood from the places Qloo filed there, and measures the booked room against it. */
export function placeLocal(local: Local, room: Room | undefined, nearby: Spot[], city: string, log: Log): Local {
  const names = new Map<string, number>();
  for (const s of nearby) if (s.area) names.set(s.area, (names.get(s.area) ?? 0) + 1);
  const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const trait = nearby.find((s) => s.area === name && s.areaTrait)?.areaTrait;
  const out: Local = { ...local, hot: { ...local.hot, ...(name ? { name } : {}), ...(trait ? { trait } : {}) } };
  if (room?.lat !== undefined && room.lon !== undefined) {
    const h = placeHeat(local.tiles, { lat: room.lat, lon: room.lon });
    if (h) {
      out.roomKm = h.km;
      out.inHot = h.inHot;
      log({
        kind: "rule",
        text: `Is ${room.name} where ${city}'s fans are?`,
        result: h.km <= HOT_KM ? `Yes: it sits in the fans' strongest area${name ? ` (${name})` : ""}.` : h.inHot ? `It sits on one of the fans' strongest tiles, ${h.km} km from ${name ?? "the hottest one"}.` : `${h.km} km from the fans' strongest area${name ? ` (${name})` : ""}.`,
      });
    }
  }
  return out;
}

/** The tag kinds worth a sentence in a pitch, best first; regions and instruments are left out. */
const SHARED_KINDS = ["urn:tag:style:qloo", "urn:tag:theme:qloo", "urn:tag:audience:qloo", "urn:tag:music:qloo", "urn:tag:artist:qloo", "urn:tag:genre:music", "urn:tag:characteristic:music"];
/** Words every audience shares, which say nothing about this pair. */
const BLAND = /^(straightforward|simple chord progressions|moderate|melodic|simple|steady|electric|acoustic|drums|guitar|vocals)$/i;

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
