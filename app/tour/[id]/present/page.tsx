import type { Metadata } from "next";
import { notFound } from "next/navigation";
import raw from "@/data/outside2/results.json";
import { Present, type ProofHeadline } from "@/components/tour/Present";
import { publicTour } from "@/lib/publictour";
import { loadTour } from "@/lib/store";
import { clearedRerun, withReadLog } from "../readlog";
import { flagshipReality } from "../reality";

export const dynamic = "force-dynamic";

type Contrast = { name: string; n: number; meanA: number; meanB: number; diff: number; wins: number; losses: number; ties: number; p: number };
type Results = { postcut: { n: number; primary: Contrast[] } };

/** /proof's headline, read from the same results file /proof prints (data/outside2/results.json). */
function headline(): ProofHeadline | null {
  const post = (raw as unknown as Results).postcut;
  const blend = post.primary.find((c) => c.name === "Qloo + population vs population");
  const model = post.primary.find((c) => c.name === "Qloo vs the model alone");
  if (!blend) return null;
  return { tours: post.n, blend, ...(model ? { model } : {}) };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const rec = await loadTour((await params).id).catch(() => null);
  return { title: rec?.plan?.artist ? `${rec.plan.artist.name}, presented` : "Tour not found", robots: { index: false } };
}

/** The tour as slides for a live presentation: the stored record only (no run), trimmed as the tour page is. */
export default async function PresentPage({ params }: { params: Promise<{ id: string }> }) {
  const rec = await loadTour((await params).id);
  if (!rec || rec.status !== "done" || !rec.plan?.stops?.length) notFound();
  const rerun = rec.engine?.check?.after ? await clearedRerun() : undefined;
  const reality = await flagshipReality(rec.id, rec.plan.artist.name);
  return <Present rec={withReadLog(publicTour(rec))} proof={headline()} rerun={rerun} reality={reality} />;
}
