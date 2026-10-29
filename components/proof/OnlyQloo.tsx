import Link from "next/link";
import { populationRanking } from "@/lib/headtohead";
import { loadTour } from "@/lib/store";
import s from "@/app/proof/proof.module.css";

/**
 * The top of /proof: what only Qloo produced on the flagship tour. Every figure is read from the stored tour record
 * (plan.stops against plan.guess, the same model routing the same tour with no Qloo), so the copy can't drift from it.
 */

export const FLAGSHIP = "8v4ce57nx6";
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export async function OnlyQloo() {
  const t = await loadTour(FLAGSHIP).catch(() => null);
  const p = t?.plan;
  const g = p?.guess;
  if (!t || !p || !g?.stops.length) return null;
  const pop = populationRanking(p.region);
  const sizeRank = (id: string) => pop.indexOf(id) + 1 || undefined;
  const theirs = new Set(g.stops.map((x) => x.marketId).filter(Boolean));
  const ours = new Set(p.stops.map((x) => x.marketId));
  const only = p.stops.filter((x) => !theirs.has(x.marketId)).sort((a, b) => a.score.rank - b.score.rank);
  const instead = g.stops.filter((x) => x.marketId && !ours.has(x.marketId));
  const shared = p.stops.filter((x) => theirs.has(x.marketId));
  const top = only[0];
  const meanR = g.rankMean.routed, meanG = g.rankMean.guess;
  return (
    <div className={s.only}>
      <p className={s.onlyLead}>
        On the flagship tour, {p.artist.name} from {t.input.from.split(",")[0]}, two counts, each against its own baseline: {p.qlooDiff ? `${p.qlooDiff.added.length} of ${p.stops.length} stops changed against the same rules on city size alone; ` : ""}
        {only.length} of the {p.stops.length} cities the same model without Qloo didn&apos;t pick. Those {only.length}:
      </p>
      <ol className={s.onlyList}>
        {only.map((x) => {
          const size = sizeRank(x.marketId);
          return (
            <li key={x.marketId}>
              <b>{x.city}</b>
              <span>{`#${x.score.rank} for her fans${size ? `, #${size} by size` : ""}`}</span>
            </li>
          );
        })}
      </ol>
      <p className={s.onlyNote}>
        {top && sizeRank(top.marketId) ? (
          <>
            {top.city} is the clearest case: #{top.score.rank} on her fan map, with {sizeRank(top.marketId)! - 1} touring cities in the region bigger than it.{" "}
          </>
        ) : null}
        The model alone went to {andList(instead.map((x) => `${x.city}${x.rank ? ` (#${x.rank})` : ""}`))} instead
        {meanR !== undefined && meanG !== undefined ? `, so its cities averaged #${Math.round(meanG)} for her fans against Routed's #${Math.round(meanR)}` : ""}. Both tours played {andList(shared.map((x) => x.city))}.
      </p>
      <p className={s.onlyFine}>
        Fan rank: a city&apos;s place among the {g.ranked} cities on her Qloo heatmap. Size: its place by metro population among the region&apos;s {pop.length} touring cities. That ruler is Qloo&apos;s own, so it shows what Qloo changed, not that Qloo is right; the rulers Qloo didn&apos;t make follow, losses included.{" "}
        <Link href={`/tour/${t.id}`}>Open the tour book</Link>
      </p>
    </div>
  );
}
