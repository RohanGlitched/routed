import "server-only";
import { marketById, type Market } from "../geo/markets";
import { describeRequest, recommend, type Entity } from "../qloo";
import type { Artist, LogLine, Opener, Room, Spot } from "../types";

/**
 * The per-city Qloo lookups the agent can call, each logged with its plain question and exact request.
 * Tag URNs come from env so a probe result can change them without a deploy.
 */
export const VENUE_TAGS = (process.env.QLOO_VENUE_TAGS ?? "urn:tag:genre:place:music_venue").split(",");
export const AFTER_TAGS = (process.env.QLOO_AFTER_TAGS ?? "urn:tag:genre:place:bar").split(",");

export type Log = (line: Omit<LogLine, "at">) => void;

/** The name Qloo's locality matcher resolves best: "Portland, Oregon"-style, not "Portland, OR". */
export function placeQuery(m: Market): string {
  if (m.cc === "US") return `${m.ascii}, ${m.state}`;
  return `${m.ascii}`;
}

const pct = (v?: number) => (v === undefined ? "" : ` ${Math.round(v * 100)}`);

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const r = await fn();
  return [r, Date.now() - t];
}

const toRoom = (e: Entity): Room => ({
  id: e.id,
  name: e.name,
  address: e.place?.address ?? e.disambiguation,
  lat: e.place?.lat,
  lon: e.place?.lon,
  affinity: e.affinity,
  popularity: e.popularity,
  rating: e.place?.rating,
  website: e.place?.website,
  image: e.image,
  tags: e.tags.map((t) => t.name).slice(0, 6),
});

/** Rooms in this city whose crowd matches the artist's fans: places tagged as music venues, ranked by Qloo
 *  affinity to the artist. */
export async function lookUpRooms(artist: Artist, marketId: string, log: Log): Promise<Room[]> {
  const m = marketById(marketId);
  if (!m) return [];
  try {
    const [r, ms] = await timed(() => recommend({ type: "urn:entity:place", signals: [artist.id], filterLocation: placeQuery(m), tags: VENUE_TAGS, take: 8 }));
    const rooms = r.entities.filter((e) => !e.place?.isClosed).map(toRoom).slice(0, 6);
    log({ kind: "qloo", text: `Which rooms in ${m.name} do ${artist.name} fans go to?`, result: rooms.length ? rooms.slice(0, 3).map((x) => `${x.name}${pct(x.affinity)}`).join(", ") : "No music venues came back.", request: describeRequest(r.request), ms });
    return rooms;
  } catch (e) {
    log({ kind: "qloo", text: `Which rooms in ${m.name} do ${artist.name} fans go to?`, result: (e as Error).message, failed: true });
    return [];
  }
}

/** Openers: artists whose audience matches the headliner's, weighted to this city's taste, and not bigger than
 *  the headliner. */
export async function lookUpOpeners(artist: Artist, marketId: string, log: Log): Promise<Opener[]> {
  const m = marketById(marketId);
  if (!m) return [];
  try {
    const [r, ms] = await timed(() =>
      recommend({
        type: "urn:entity:artist",
        signals: [artist.id],
        signalLocation: placeQuery(m),
        exclude: [artist.id],
        take: 8,
        extra: artist.popularity !== undefined ? { "filter.popularity.max": Math.min(0.999, Math.max(0.3, artist.popularity)).toFixed(3) } : {},
      }),
    );
    const openers: Opener[] = r.entities
      .filter((e) => e.id !== artist.id)
      .slice(0, 5)
      .map((e) => ({ id: e.id, name: e.name, image: e.image, affinity: e.affinity, popularity: e.popularity, description: e.description, shared: [] }));
    log({ kind: "qloo", text: `Who could open in ${m.name}, for an audience like ${artist.name}'s?`, result: openers.length ? openers.slice(0, 3).map((x) => `${x.name}${pct(x.affinity)}`).join(", ") : "No artists came back.", request: describeRequest(r.request), ms });
    return openers;
  } catch (e) {
    log({ kind: "qloo", text: `Who could open in ${m.name}?`, result: (e as Error).message, failed: true });
    return [];
  }
}

/** Cross-domain: the bars this artist's fans over-index on in the city, for the aftershow and the advance. */
export async function lookUpAfter(artist: Artist, marketId: string, log: Log): Promise<Spot[]> {
  const m = marketById(marketId);
  if (!m) return [];
  try {
    const [r, ms] = await timed(() => recommend({ type: "urn:entity:place", signals: [artist.id], filterLocation: placeQuery(m), tags: AFTER_TAGS, take: 3 }));
    const spots = r.entities.slice(0, 2).map((e) => ({ id: e.id, name: e.name, address: e.place?.address ?? e.disambiguation, affinity: e.affinity }));
    log({ kind: "qloo", text: `Where do ${artist.name} fans go out in ${m.name}?`, result: spots.map((s) => s.name).join(", ") || "Nothing came back.", request: describeRequest(r.request), ms });
    return spots;
  } catch (e) {
    log({ kind: "qloo", text: `Where do ${artist.name} fans go out in ${m.name}?`, result: (e as Error).message, failed: true });
    return [];
  }
}
