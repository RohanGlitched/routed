import { NextResponse } from "next/server";
import { loadTour } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rec = await loadTour((await params).id);
  if (!rec) return NextResponse.json({ error: "No tour with that link." }, { status: 404 });
  return NextResponse.json(rec, { headers: { "cache-control": "no-store" } });
}
