import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { addCapacities } from "@/lib/web";

export const runtime = "nodejs";

/**
 * Adds room capacities measured by scripts/measure-rooms.ts (the same reader, run from a machine Wikidata doesn't
 * throttle) to the shared room index: {entries: {<Qloo room id>: {value, source, quote}}}. A room that already has
 * a number keeps it. Needs ADMIN_TOKEN.
 */
export async function POST(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { entries?: Record<string, { value: number; source: string; quote: string }> } | null;
  if (!body?.entries || typeof body.entries !== "object") return NextResponse.json({ error: "Send {entries}." }, { status: 400 });
  const added = await addCapacities(body.entries);
  return NextResponse.json({ ok: true, added });
}
