import { NextResponse } from "next/server";
import { runTour, type Event } from "@/lib/agent/run";
import { takeModelRun } from "@/lib/budget";
import { hasKey } from "@/lib/nebius";
import { hasQloo } from "@/lib/qloo";
import { loadTour, updateTour } from "@/lib/store";
import type { Plan, TourRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STALE_MS = 4 * 60_000;

/**
 * Runs a queued tour and streams its events as NDJSON. Only one caller can claim a tour; anyone else gets 409
 * and polls the record. Progress is saved as it arrives, so a reload mid-run picks up where it is.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasQloo()) return NextResponse.json({ error: "Routed isn't connected to Qloo right now." }, { status: 503 });
  const claimedAt = new Date().toISOString();
  const claimed = await updateTour(id, (r) => {
    const stale = r.status === "running" && r.startedAt && Date.now() - Date.parse(r.startedAt) > STALE_MS;
    if (r.status !== "queued" && !stale) return null;
    return { ...r, status: "running", startedAt: claimedAt, log: [] };
  });
  if (!claimed) {
    const rec = await loadTour(id);
    return NextResponse.json({ error: rec ? "This tour is already routing or done." : "No tour with that link.", status: rec?.status }, { status: rec ? 409 : 404 });
  }

  const useModel = hasKey() && (await takeModelRun());
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Event) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      const acc: Pick<TourRecord, "log"> & Partial<TourRecord> = { log: [] };
      let plan: Partial<Plan> = {};
      let lastSave = 0;
      const save = async () => {
        const patch = { ...acc, plan: plan as Plan };
        await updateTour(id, (r) => ({ ...r, ...patch })).catch((e) => console.error("[run] save failed", e));
      };
      try {
        let done: Event | null = null;
        for await (const e of runTour(claimed.input, useModel)) {
          // "done" goes out only after the final save, so a reload right after it shows the finished tour.
          if (e.t === "done") {
            done = e;
            acc.status = "done";
            acc.engine = e.engine;
            acc.finishedAt = e.at;
            continue;
          }
          send(e);
          if (e.t === "log") acc.log.push(e.line);
          else if (e.t === "plan") {
            plan = { ...plan, ...e.plan };
            if (Date.now() - lastSave > 2500) {
              lastSave = Date.now();
              await save();
            }
          } else if (e.t === "error") {
            acc.status = "failed";
            acc.error = e.message;
          }
        }
        if (!acc.status) acc.status = "failed";
        await save();
        if (done) send(done);
        controller.close();
        return;
      } catch (err) {
        console.error("[run] tour failed", err);
        acc.status = "failed";
        acc.error = "The routing stopped partway. Run it again in a minute.";
        send({ t: "error", message: acc.error });
      }
      await save();
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
