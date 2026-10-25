import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { recheckTour } from "@/lib/agent/recheck";
import { shelfTours, updateTour } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Re-runs the figure checker over every tour on the poster wall and the benchmark (lib/agent/recheck.ts): no model
 * and no Qloo call, only the stored pitches and reasons checked again. {dry: true} reports without writing. Needs ADMIN_TOKEN.
 */
export async function POST(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { dry?: boolean } | null;
  const seen = new Set<string>();
  const out: { id: string; artist?: string; before: number; after: number; changed: string[] }[] = [];
  for (const t of [...(await shelfTours("showcase")), ...(await shelfTours("bench"))]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const r = recheckTour(t);
    if (r.changed.length && !body?.dry) await updateTour(t.id, (cur) => recheckTour(cur).rec);
    out.push({ id: t.id, artist: t.plan?.artist.name, before: r.before, after: r.after, changed: r.changed });
  }
  if (!body?.dry && out.some((x) => x.changed.length)) revalidateTag("tours");
  return NextResponse.json({ ok: true, dry: Boolean(body?.dry), tours: out.filter((x) => x.changed.length), checked: out.length });
}
