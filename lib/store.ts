import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";
import { storage } from "./storage";
import { TOUR_ID, type TourRecord } from "./types";

/**
 * One JSON document per tour: an object in the configured store (Google Cloud Storage or Vercel Blob, written
 * with a version check), a file under .data/ locally. A store's version tag can lag after an overwrite, so
 * updates retry with backoff and write unconditionally on the last try rather than lose a result.
 */
const useBlob = () => storage() !== null;
const LOCAL_DIR = path.join(process.cwd(), ".data", "tours");
const key = (id: string) => `tours/${id}.json`;

async function readRaw(id: string): Promise<{ rec: TourRecord; etag?: string } | null> {
  if (!TOUR_ID.test(id)) return null;
  if (!useBlob()) {
    try {
      return { rec: JSON.parse(await fs.readFile(path.join(LOCAL_DIR, `${id}.json`), "utf8")) };
    } catch {
      return null;
    }
  }
  const r = await storage()!.read(key(id)).catch(() => null);
  if (!r) return null;
  return { rec: JSON.parse(r.text) as TourRecord, etag: r.etag };
}

async function writeRaw(rec: TourRecord, etag?: string): Promise<void> {
  if (!useBlob()) {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIR, `${rec.id}.json`), JSON.stringify(rec, null, 2));
    return;
  }
  await storage()!.write(key(rec.id), JSON.stringify(rec), { ifMatch: etag });
}

export const loadTour = cache(async (id: string): Promise<TourRecord | null> => (await readRaw(id))?.rec ?? null);

export async function saveTour(rec: TourRecord): Promise<void> {
  await writeRaw(rec);
}

/** Read-modify-write. `fn` returns the new record, or null to leave it alone. Returns what was written, or null. */
export async function updateTour(id: string, fn: (rec: TourRecord) => TourRecord | null): Promise<TourRecord | null> {
  const ATTEMPTS = 5;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const cur = await readRaw(id);
    if (!cur) return null;
    const next = fn(structuredClone(cur.rec));
    if (!next) return null;
    const last = attempt === ATTEMPTS - 1;
    try {
      await writeRaw(next, last ? undefined : cur.etag);
      return next;
    } catch (e) {
      if (last) throw new Error(`Couldn't save the tour (${(e as Error).message}).`);
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1) + Math.random() * 150));
    }
  }
  return null;
}

export type Shelf = "showcase" | "bench";

/** Tours on a shelf, newest first: "showcase" (the poster wall) or "bench" (the with/without-Qloo benchmark). */
export async function shelfTours(shelf: Shelf): Promise<TourRecord[]> {
  let ids: string[] = [];
  if (!useBlob()) {
    ids = (await fs.readdir(LOCAL_DIR).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  } else {
    const names = await storage()!.list(`${shelf}/`, 100);
    ids = names.map((n) => n.slice(shelf.length + 1, -5));
  }
  const recs = (await Promise.all(ids.map((id) => loadTour(id).catch(() => null)))).filter((r): r is TourRecord => Boolean(r?.[shelf] && r.status === "done"));
  return recs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const showcaseTours = () => shelfTours("showcase");

/** Puts a tour on a shelf (an empty marker blob, so listing stays cheap). */
export async function shelve(id: string, shelf: Shelf): Promise<void> {
  await updateTour(id, (r) => ({ ...r, [shelf]: true }));
  if (useBlob()) await storage()!.write(`${shelf}/${id}.json`, "{}");
}
