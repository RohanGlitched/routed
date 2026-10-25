import { NextResponse } from "next/server";
import { publicTour } from "@/lib/publictour";
import { loadTour } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rec = await loadTour((await params).id);
  if (!rec) return NextResponse.json({ error: "No tour with that link." }, { status: 404 });
  // Only what the pages draw (M8: no Qloo response data published); the stored record keeps everything.
  return NextResponse.json(publicTour(rec), { headers: { "cache-control": "no-store" } });
}
