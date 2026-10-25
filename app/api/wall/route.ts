import { NextResponse } from "next/server";
import { wallPosters } from "@/lib/showcase";

export const runtime = "nodejs";
/** Built like a page: once per five minutes, served from the CDN in between. */
export const revalidate = 300;

/** The poster wall's posters as drawing data, keyed by tour id. The home page fetches it when the wall scrolls near. */
export async function GET() {
  const posters = await wallPosters().catch(() => null);
  if (!posters) return NextResponse.json({ error: "The poster wall couldn't be read." }, { status: 503, headers: { "cache-control": "no-store" } });
  return NextResponse.json(posters, { headers: { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400" } });
}
