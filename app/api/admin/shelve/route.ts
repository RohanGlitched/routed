import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { shelve, type Shelf } from "@/lib/store";
import { TOUR_ID } from "@/lib/types";

export const runtime = "nodejs";

/** Puts a finished tour on the poster wall or the benchmark. Needs ADMIN_TOKEN; without it the route doesn't exist. */
export async function POST(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { id?: string; shelf?: string } | null;
  const shelf = body?.shelf as Shelf;
  if (!body?.id || !TOUR_ID.test(body.id) || (shelf !== "showcase" && shelf !== "bench")) return NextResponse.json({ error: "Send {id, shelf: showcase|bench}." }, { status: 400 });
  await shelve(body.id, shelf);
  return NextResponse.json({ ok: true });
}
