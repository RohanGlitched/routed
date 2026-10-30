import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { FLAGSHIP, type RealityCheck } from "@/components/tour/realityFacts";

const url = z.string().regex(/^https?:\/\/\S+$/);
const schema = z.object({
  artist: z.string().min(1),
  checked: z.string().min(1),
  tour: z.object({ name: z.string().min(1), years: z.string(), source: url }),
  realCities: z.array(z.object({ city: z.string().min(1), played: z.boolean(), venue: z.string(), capacity: z.number().positive().optional(), capacitySource: url.optional(), routedCity: z.string().min(1).optional() })).min(1),
  routedCities: z.array(z.object({ city: z.string().min(1), onRealTour: z.boolean(), venue: z.string().optional(), played: z.object({ year: z.string().regex(/^\d{4}$/), venue: z.string().min(1), note: z.string().optional(), finale: z.boolean().optional(), source: url }).optional() })).min(1),
  summary: z.string(),
  usualCrowd: z.object({ input: z.number().positive(), inputScale: z.string().optional(), realMedian: z.number().positive().optional(), note: z.string() }).optional(),
  sources: z.array(z.object({ title: z.string().min(1), url })),
});

/**
 * The flagship's reality check, from data/flagship-reality.json (cited public listings, written by hand). None when
 * the file is missing or doesn't read as the schema, so the panel just isn't there. Outside production a copy in
 * .data/ (never committed) stands in, for checking the panel locally.
 */
export async function flagshipReality(id: string, artist?: string): Promise<RealityCheck | undefined> {
  if (id !== FLAGSHIP) return undefined;
  const files = [path.join(process.cwd(), "data", "flagship-reality.json")];
  if (process.env.NODE_ENV !== "production") files.push(path.join(process.cwd(), ".data", "flagship-reality.json"));
  for (const f of files) {
    const text = await fs.readFile(f, "utf8").catch(() => null);
    if (!text) continue;
    try {
      const r = schema.safeParse(JSON.parse(text));
      if (!r.success) {
        console.error("[reality] data/flagship-reality.json doesn't match the schema", r.error.issues[0]?.path.join("."));
        return undefined;
      }
      if (artist && r.data.artist.trim().toLowerCase() !== artist.trim().toLowerCase()) return undefined;
      return r.data;
    } catch {
      console.error("[reality] data/flagship-reality.json isn't JSON");
      return undefined;
    }
  }
  return undefined;
}
