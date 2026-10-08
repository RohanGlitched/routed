import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { rescore } from "@/lib/agent/guess";
import { shelfTours, updateTour } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Re-matches the benchmark's model-alone cities after a city-matching fix. Needs ADMIN_TOKEN. */
export async function POST(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const out: { id: string; artist?: string; before?: number; after?: number }[] = [];
  for (const t of await shelfTours("bench")) {
    const before = t.plan?.guess?.rankMean.guess;
    const next = t.plan ? await rescore(t.plan) : undefined;
    if (!next) continue;
    await updateTour(t.id, (r) => (r.plan ? { ...r, plan: { ...r.plan, guess: next } } : null));
    out.push({ id: t.id, artist: t.plan?.artist.name, before, after: next.rankMean.guess });
  }
  return NextResponse.json({ ok: true, tours: out });
}
