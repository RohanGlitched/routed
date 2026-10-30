import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TourRoom } from "@/components/tour/TourRoom";
import { publicTour } from "@/lib/publictour";
import { loadTour } from "@/lib/store";
import { clearedRerun, sameArtistRerun, withReadLog } from "./readlog";
import { flagshipReality } from "./reality";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const rec = await loadTour((await params).id).catch(() => null);
  if (!rec) return { title: "Tour not found" };
  const p = rec.plan;
  const shows = p?.stops?.reduce((n, s) => n + (s.nights ?? 1), 0);
  const count = p?.stops?.length ? (shows! > p.stops.length ? `${p.stops.length} cities (${shows} shows)` : `${shows} shows`) : `${rec.input.shows} shows`;
  const title = p?.artist ? `${p.artist.name}: ${count} from ${p.from?.label ?? rec.input.from}` : `Routing ${rec.input.artist}`;
  return { title, description: p?.stops?.length ? `Routed by fan affinity on Qloo's taste graph: ${p.stops.map((s) => s.city).join(", ")}.` : undefined };
}

export default async function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const rec = await loadTour((await params).id);
  if (!rec) notFound();
  // The page carries the same trimmed record the API serves (M8), not the stored one, its call sheet read against
  // what was booked; a tour whose agent left objections links the re-run where the agent cleared its own.
  const rerun = rec.status === "done" && rec.engine?.check?.after ? await clearedRerun() : undefined;
  const reality = rec.status === "done" ? await flagshipReality(rec.id, rec.plan?.artist?.name) : undefined;
  const same = rec.status === "done" ? await sameArtistRerun(rec.id) : undefined;
  return <TourRoom initial={withReadLog(publicTour(rec))} rerun={rerun} same={same} reality={reality} />;
}
