import "server-only";
import { unstable_cache } from "next/cache";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PosterProps } from "@/components/poster/Poster";
import { findMarket, km, type RegionId } from "./geo/markets";
import { posterFor } from "./poster";
import { storage } from "./storage";
import { loadTour, shelfTours } from "./store";
import type { TourRecord } from "./types";

/**
 * What the home page, /proof and the cap fallback read from the stored tours, cached across requests.
 *
 * Every storage read is a `cache: "no-store"` fetch (the tours change when the admin re-checks them), and a
 * no-store fetch in a page opts the whole page out of ISR, so before Oct 25 every visit to / read 30 tours of
 * about 300 KB each from GCS and took about 2 s. Inside `unstable_cache` the same reads don't mark the page
 * dynamic: the page is built once per revalidate window and served from the CDN in between.
 *
 * Revalidate after a shelf changes with revalidateTag("showcase") or revalidateTag("bench"); "tours" covers both.
 */
const WINDOW = 300;

/** "Fontaines D.C." → "fontainesdc", "The War on Drugs" → "warondrugs": how a typed name is matched to a tour. */
export function artistKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

/** A wall tour in a few fields: enough to list it, match it to a typed artist and find the nearest one. */
export type WallItem = {
  id: string;
  artist: string;
  keys: string[];
  /** Cities on the tour, and nights across them (a two-night stand is two shows): "8 cities (12 shows)". */
  shows: number;
  nights: number;
  from: string;
  /** The cities' average rank on the artist's Qloo fan map (1 = strongest), the one number on the wall card. */
  fanRank: number;
  region: RegionId;
  lat: number;
  lon: number;
  createdAt: string;
};

export type BenchSummary = { n: number; routed: number; guess: number };

/** The hero tour without its run log (a third of the record, and the page never shows it). */
function slimHero(t: TourRecord): TourRecord {
  return { ...t, log: [] };
}

/** A benchmark tour with only what /proof reads: no log, no heatmap, no per-stop lookups. */
function slimBench(t: TourRecord): TourRecord {
  if (!t.plan) return { ...t, log: [] };
  const p = t.plan;
  return {
    ...t,
    log: [],
    plan: {
      ...p,
      heat: [],
      audience: { ...p.audience, brands: [], tags: [], trend: [], taste: undefined, media: undefined },
      stops: p.stops.map((s) => ({
        ...s,
        rooms: s.rooms.filter((r) => r.id === s.roomId),
        openers: s.openers.filter((o) => o.id === s.openerId),
        after: [],
        posters: undefined,
        local: undefined,
        pitch: undefined,
      })),
    },
  };
}

const wallItem = (t: TourRecord): WallItem => ({
  id: t.id,
  artist: t.plan!.artist.name,
  keys: [...new Set([artistKey(t.plan!.artist.name), artistKey(t.input.artist)])],
  shows: t.plan!.stops.length,
  nights: t.plan!.stops.reduce((n, x) => n + (x.nights ?? 1), 0),
  from: t.plan!.from.label,
  fanRank: t.plan!.guess?.rankMean.routed ?? t.plan!.stops.reduce((n, x) => n + x.score.rank, 0) / t.plan!.stops.length,
  region: t.plan!.region,
  lat: t.plan!.from.lat,
  lon: t.plan!.from.lon,
  createdAt: t.createdAt,
});

function summarise(tours: TourRecord[]): BenchSummary | null {
  const ok = tours.filter((t) => t.plan?.guess?.rankMean.guess !== undefined);
  if (!ok.length) return null;
  const avg = (f: (t: TourRecord) => number) => ok.reduce((a, t) => a + f(t), 0) / ok.length;
  return { n: ok.length, routed: avg((t) => t.plan!.guess!.rankMean.routed ?? 0), guess: avg((t) => t.plan!.guess!.rankMean.guess ?? 0) };
}

/** The poster wall and the hero, read fresh: throws when the store can't be read, so a failure isn't cached. */
async function readWall(): Promise<{ hero: TourRecord | null; wall: TourRecord[] }> {
  const wall = await shelfTours("showcase");
  const pinned = process.env.SHOWCASE_ID ? await loadTour(process.env.SHOWCASE_ID).catch(() => null) : null;
  // The pin holds only while that tour is on the poster wall; a tour taken off it (re-routed under newer rules)
  // gives way to the newest one there.
  const hero = pinned?.status === "done" && pinned.showcase ? pinned : (wall[0] ?? null);
  return { hero, wall: wall.filter((t) => t.plan?.stops?.length) };
}

/** Everything the home page reads: the hero tour, the wall in a few fields each, and the benchmark in two numbers. */
export const homeData = unstable_cache(
  async (): Promise<{ hero: TourRecord | null; wall: WallItem[]; bench: BenchSummary | null }> => {
    const [{ hero, wall }, bench] = await Promise.all([readWall(), benchTours()]);
    return { hero: hero ? slimHero(hero) : null, wall: wall.map(wallItem), bench: summarise(bench) };
  },
  ["home-data-v3"],
  { revalidate: WINDOW, tags: ["showcase", "bench", "tours"] },
);

/** The wall's posters, drawn data only (about 25 KB a poster), for /api/wall: the page lists the wall and the
 *  browser prints each poster when it scrolls near, so the home HTML doesn't carry 13,000 halftone dots. */
export const wallPosters = unstable_cache(
  async (): Promise<Record<string, PosterProps>> => {
    const { wall } = await readWall();
    const out: Record<string, PosterProps> = {};
    for (const t of wall) {
      const p = posterFor(t.plan!);
      if (p) out[t.id] = p;
    }
    return out;
  },
  ["wall-posters-v1"],
  { revalidate: WINDOW, tags: ["showcase", "tours"] },
);

/** The ids on the benchmark shelf (the same listing store.ts makes: marker objects in the store, files locally). */
const benchIds = unstable_cache(
  async (): Promise<string[]> => {
    const s = storage();
    if (s) return (await s.list("bench/", 100)).map((n) => n.slice("bench/".length, -5));
    return (await fs.readdir(path.join(process.cwd(), ".data", "tours")).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  },
  ["bench-ids-v1"],
  { revalidate: WINDOW, tags: ["bench", "tours"] },
);

/** One benchmark tour, slimmed, cached on its own: twenty of them together would pass the data cache's 2 MB
 *  limit for one entry. Null when it isn't a finished tour on the shelf. */
const benchTour = unstable_cache(
  async (id: string): Promise<TourRecord | null> => {
    const t = await loadTour(id);
    return t?.bench && t.status === "done" ? slimBench(t) : null;
  },
  ["bench-tour-v1"],
  { revalidate: WINDOW, tags: ["bench", "tours"] },
);

/** The benchmark tours for /proof, newest first, slimmed to what it reads (about 85 KB a tour instead of 300). */
export async function benchTours(): Promise<TourRecord[]> {
  const ids = await benchIds();
  const tours = (await Promise.all(ids.map((id) => benchTour(id).catch(() => null)))).filter((t): t is TourRecord => Boolean(t));
  return tours.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ───────────────────────── the cap fallback ───────────────────────── */

const INDEX = (key: string) => `artists/${key}.json`;
const INDEX_KEEP = 6;

/** Notes a new tour under the typed artist, so a later visitor asking for the same artist when the Qloo
 *  allowance is spent gets this tour. Best effort: a failed write costs nothing but that match. */
export async function rememberArtistTour(artist: string, id: string): Promise<void> {
  const s = storage();
  const key = artistKey(artist);
  if (!s || !key) return;
  try {
    const cur = await s.read(INDEX(key)).catch(() => null);
    const ids = cur ? ((JSON.parse(cur.text) as { ids?: string[] }).ids ?? []) : [];
    await s.write(INDEX(key), JSON.stringify({ ids: [id, ...ids.filter((x) => x !== id)].slice(0, INDEX_KEEP) }));
  } catch (e) {
    console.error("[showcase] artist index write failed", (e as Error).message);
  }
}

export type Stored = { id: string; artist: string; match: "artist" | "nearest"; from: string; shows: number; nights: number };

const usable = (t: TourRecord | null): t is TourRecord => Boolean(t && t.status === "done" && t.plan?.stops?.length);

/**
 * The stored tour to open instead of a new one: the newest finished tour of the typed artist (any tour routed
 * since Oct 25, or one on the poster wall or the benchmark shelf), else the wall tour whose start is nearest the
 * typed starting city, preferring the same region.
 */
export async function storedTourFor(artist: string, from: string): Promise<Stored | null> {
  const key = artistKey(artist);
  const s = storage();
  if (s && key) {
    const cur = await s.read(INDEX(key)).catch(() => null);
    const ids = cur ? ((JSON.parse(cur.text) as { ids?: string[] }).ids ?? []) : [];
    for (const id of ids) {
      const t = await loadTour(id).catch(() => null);
      if (usable(t)) return { id: t.id, artist: t.plan!.artist.name, match: "artist", from: t.plan!.from.label, shows: t.plan!.stops.length, nights: t.plan!.stops.reduce((n, x) => n + (x.nights ?? 1), 0) };
    }
  }
  const { wall } = await homeData().catch(() => ({ wall: [] as WallItem[] }));
  const same = wall.find((w) => w.keys.includes(key));
  if (same) return { id: same.id, artist: same.artist, match: "artist", from: same.from, shows: same.shows, nights: same.nights ?? same.shows };
  const bench = await benchTours().catch(() => [] as TourRecord[]);
  const b = bench.find((t) => usable(t) && (artistKey(t.plan!.artist.name) === key || artistKey(t.input.artist) === key));
  if (b) return { id: b.id, artist: b.plan!.artist.name, match: "artist", from: b.plan!.from.label, shows: b.plan!.stops.length, nights: b.plan!.stops.reduce((n, x) => n + (x.nights ?? 1), 0) };
  if (!wall.length) return null;
  const home = findMarket(from);
  const near = [...wall].sort((a, z) => {
    if (!home) return 0;
    const ra = a.region === home.region ? 0 : 1, rz = z.region === home.region ? 0 : 1;
    return ra - rz || km(home, a) - km(home, z);
  })[0]!;
  return { id: near.id, artist: near.artist, match: "nearest", from: near.from, shows: near.shows, nights: near.nights ?? near.shows };
}
