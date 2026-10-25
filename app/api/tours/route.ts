import { NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ipAllowed, QLOO_PER_TOUR, qlooRemaining, toursLeft } from "@/lib/budget";
import { findMarket } from "@/lib/geo/markets";
import { rememberArtistTour, storedTourFor } from "@/lib/showcase";
import { saveTour } from "@/lib/store";
import { newTourId, type TourRecord } from "@/lib/types";
import { clientIp } from "@/lib/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** The biggest crowd the form offers (25,000), with room for an MCP caller. */
const MAX_DRAW = 30_000;

/** The benchmark runner sends ADMIN_TOKEN so its 14 tours aren't held to the per-visitor limit. */
function isAdmin(req: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(token) && given.length === token!.length && timingSafeEqual(Buffer.from(given), Buffer.from(token!));
}

/** How many new tours the Qloo allowance still covers, today and this hour, for the line under the form. */
export async function GET() {
  const left = await toursLeft().catch(() => null);
  if (!left) return NextResponse.json({ error: "Couldn't read the allowance." }, { status: 503, headers: { "cache-control": "no-store" } });
  return NextResponse.json(left, { headers: { "cache-control": "no-store" } });
}

/**
 * Queues a tour. The page then calls /run to stream it; the record keeps the result for the share link.
 *
 * When this hour's or today's Qloo allowance can't cover another tour, nothing is queued: the answer is the
 * stored tour for that artist (matched by name among every tour routed since Oct 25 and the poster wall), or the
 * poster-wall tour that starts nearest the typed city, with `stored` saying which and why. It is still a 200, so
 * a judge on a busy hour opens a finished tour instead of an error.
 */
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
  if (draw !== undefined && !(draw >= 50 && draw <= MAX_DRAW)) return NextResponse.json({ error: "Pick a crowd size from the list.", field: "draw" }, { status: 400 });

  // The allowance first: a stored tour costs nothing, so it doesn't count against the visitor's own limit.
  if ((await qlooRemaining().catch(() => 0)) < QLOO_PER_TOUR) {
    const left = await toursLeft().catch(() => null);
    const why = left?.limit === "hour" ? "this hour's" : "today's";
    const stored = await storedTourFor(artist, from).catch(() => null);
    if (!stored) return NextResponse.json({ error: `Routed has used ${why} Qloo allowance. The finished tours on the poster wall still open; new ones run again ${left?.limit === "hour" ? "at the top of the hour" : "tomorrow"}.` }, { status: 503 });
    // "8 cities (12 shows)" when a two-night stand makes the two counts differ.
    const run = stored.nights && stored.nights !== stored.shows ? `${stored.shows} cities (${stored.nights} shows)` : `${stored.shows} shows`;
    const message =
      stored.match === "artist"
        ? `Routed has used ${why} Qloo allowance, so here is the stored ${stored.artist} tour (${run} from ${stored.from}) instead of a new run.`
        : `Routed has used ${why} Qloo allowance and has no stored ${artist} tour, so here is the nearest one on the poster wall: ${stored.artist}, ${run} from ${stored.from}.`;
    return NextResponse.json({ id: stored.id, stored: { ...stored, reason: left?.limit ?? "day", ...(left?.limit === "hour" ? { retryAt: left.nextHour } : {}), message } });
  }
  if (!isAdmin(req) && !ipAllowed(await clientIp())) return NextResponse.json({ error: "That's a lot of tours in a few minutes. Try again in ten." }, { status: 429 });

  const rec: TourRecord = { id: newTourId(), createdAt: new Date().toISOString(), status: "queued", input: { artist, from, firstDate, shows, ...(draw ? { draw } : {}) }, log: [] };
  await saveTour(rec);
  // Indexed after the answer goes out, so the visitor doesn't wait on it.
  after(() => rememberArtistTour(artist, rec.id));
  return NextResponse.json({ id: rec.id });
}
