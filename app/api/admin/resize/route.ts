import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { resizeTour } from "@/lib/agent/resize";
import { loadTour, updateTour } from "@/lib/store";
import { TOUR_ID } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Re-sizes one stored tour's rooms under the current rules (lib/agent/resize.ts). Needs ADMIN_TOKEN. */
export async function POST(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id || !TOUR_ID.test(body.id)) return NextResponse.json({ error: "Send {id}." }, { status: 400 });
  const rec = await loadTour(body.id);
  if (!rec?.plan || rec.status !== "done") return NextResponse.json({ error: "No finished tour with that id." }, { status: 404 });
  const { rec: next, changed } = await resizeTour(rec);
  await updateTour(body.id, () => next);
  return NextResponse.json({ ok: true, changed, usage: next.engine?.usage });
}
