import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ipAllowed } from "@/lib/budget";
import { findMarket } from "@/lib/geo/markets";
import { saveTour } from "@/lib/store";
import { newTourId, type TourRecord } from "@/lib/types";
import { clientIp } from "@/lib/visitor";

export const runtime = "nodejs";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The benchmark runner sends ADMIN_TOKEN so its 14 tours aren't held to the per-visitor limit. */
function isAdmin(req: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(token) && given.length === token!.length && timingSafeEqual(Buffer.from(given), Buffer.from(token!));
}

/** Queues a tour. The page then calls /run to stream it; the record keeps the result for the share link. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { artist?: unknown; from?: unknown; firstDate?: unknown; shows?: unknown; draw?: unknown } | null;
  const artist = typeof body?.artist === "string" ? body.artist.trim().slice(0, 80) : "";
  const from = typeof body?.from === "string" ? body.from.trim().slice(0, 80) : "";
  const firstDate = typeof body?.firstDate === "string" && ISO.test(body.firstDate) ? body.firstDate : "";
  const shows = Math.round(Number(body?.shows));
  const draw = Math.round(Number(body?.draw)) || undefined;
  if (!artist) return NextResponse.json({ error: "Name the artist going on tour." }, { status: 400 });
  if (!from) return NextResponse.json({ error: "Say which city the tour starts from." }, { status: 400 });
  if (!findMarket(from)) return NextResponse.json({ error: `Routed doesn't know “${from}” as a city. Try the nearest bigger city, like “Portland, OR” or “Leeds, UK”.`, field: "from" }, { status: 400 });
  if (!firstDate || Number.isNaN(Date.parse(firstDate))) return NextResponse.json({ error: "Pick the date of the first show.", field: "firstDate" }, { status: 400 });
  if (Date.parse(firstDate) < Date.now() - 86_400_000) return NextResponse.json({ error: "The first show needs to be in the future.", field: "firstDate" }, { status: 400 });
  if (!(shows >= 3 && shows <= 16)) return NextResponse.json({ error: "Choose between 3 and 16 shows.", field: "shows" }, { status: 400 });
  if (draw !== undefined && !(draw >= 50 && draw <= 20_000)) return NextResponse.json({ error: "Pick a crowd size from the list.", field: "draw" }, { status: 400 });
  if (!isAdmin(req) && !ipAllowed(await clientIp())) return NextResponse.json({ error: "That's a lot of tours in a few minutes. Try again in ten." }, { status: 429 });

  const rec: TourRecord = { id: newTourId(), createdAt: new Date().toISOString(), status: "queued", input: { artist, from, firstDate, shows, ...(draw ? { draw } : {}) }, log: [] };
  await saveTour(rec);
  return NextResponse.json({ id: rec.id });
}
