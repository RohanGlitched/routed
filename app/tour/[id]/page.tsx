import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TourRoom } from "@/components/tour/TourRoom";
import { loadTour } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const rec = await loadTour((await params).id).catch(() => null);
  if (!rec) return { title: "Tour not found" };
  const p = rec.plan;
  const title = p?.artist ? `${p.artist.name}: ${p.stops?.length ?? rec.input.shows} shows from ${p.from?.label ?? rec.input.from}` : `Routing ${rec.input.artist}`;
  return { title, description: p?.stops?.length ? `Routed by fan affinity on Qloo's taste graph: ${p.stops.map((s) => s.city).join(", ")}.` : undefined };
}

export default async function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const rec = await loadTour((await params).id);
  if (!rec) notFound();
  return <TourRoom initial={rec} />;
}
