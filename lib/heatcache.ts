import "server-only";
import { createHash } from "node:crypto";
import { wherePopular, type QlooRequest, type Tile } from "./qloo";
import { storage } from "./storage";
import { countQloo } from "./usage";

/**
 * Region heatmaps kept in the store, so a repeat artist costs no Qloo call for the region step.
 *
 * The region heatmap is the biggest call a tour makes (about 6,000 tiles, 2.6 MB from Qloo) and the one most
 * worth keeping: taste data moves weekly, and during judging the same few artists get routed again and again.
 * qloo.ts already keeps each answer for six hours, but only in one server instance's memory; this copy lives in
 * GCS (heat/<entity>/<hash>.json, about 350 KB) and is shared by every instance for HEAT_CACHE_DAYS (default 7).
 *
 * Same signature and result as wherePopular, plus `storedAt` when the tiles came from the store. A miss calls
 * Qloo exactly as before and saves the answer; an empty answer or a store failure is never saved, and a store
 * failure on read just falls through to Qloo.
 */
const TTL_MS = Number(process.env.HEAT_CACHE_DAYS || 7) * 86_400_000;

type Saved = {
  v: 1;
  at: string;
  request: QlooRequest;
  /** lat, lon, affinity, rank, popularity: arrays, not objects, to keep the file small. */
  tiles: [number, number, number, number | null, number | null][];
};

const keyFor = (entityId: string, within: Parameters<typeof wherePopular>[1], take: number) =>
  `heat/${entityId.replace(/[^A-Za-z0-9-]/g, "_")}/${createHash("sha256").update(JSON.stringify([within, take])).digest("hex").slice(0, 20)}.json`;

export async function cachedWherePopular(
  entityId: string,
  within: Parameters<typeof wherePopular>[1],
  take = 50,
): Promise<{ tiles: Tile[]; request: QlooRequest; storedAt?: string }> {
  const s = storage();
  if (!s) return wherePopular(entityId, within, take);
  const key = keyFor(entityId, within, take);

  const hit = await s.read(key).catch(() => null);
  if (hit) {
    try {
      const j = JSON.parse(hit.text) as Saved;
      if (j.v === 1 && Date.now() - Date.parse(j.at) < TTL_MS && j.tiles.length) {
        countQloo(true);
        const tiles: Tile[] = j.tiles.map(([lat, lon, affinity, rank, popularity]) => ({
          lat,
          lon,
          affinity,
          ...(rank !== null ? { rank } : {}),
          ...(popularity !== null ? { popularity } : {}),
        }));
        return { tiles, request: j.request, storedAt: j.at };
      }
    } catch {
      /* a damaged copy: ask Qloo again and overwrite it */
    }
  }

  const fresh = await wherePopular(entityId, within, take);
  if (fresh.tiles.length) {
    const saved: Saved = {
      v: 1,
      at: new Date().toISOString(),
      request: fresh.request,
      tiles: fresh.tiles.map((t) => [t.lat, t.lon, t.affinity, t.rank ?? null, t.popularity ?? null]),
    };
    await s.write(key, JSON.stringify(saved)).catch((e: Error) => console.error("[heatcache] save failed", e.message));
  }
  return fresh;
}
