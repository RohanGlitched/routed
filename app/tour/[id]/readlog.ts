import "server-only";
import { roomNameMatches } from "@/lib/agent/plan";
import { lineContext, readLine } from "@/lib/log";
import { loadTour } from "@/lib/store";
import type { TourRecord } from "@/lib/types";
import type { Rerun } from "@/components/tour/AgentCheck";
import { agentStory, swapRows } from "@/components/tour/display";

/**
 * The call sheet read against what the tour finally booked: a room the agent named that Qloo's search by name missed
 * but the city's list held ("Crystal Ballroom" is McMenamins Crystal Ballroom), and a web capacity the hand check
 * overturned. Done on the server, where lib/agent/plan.ts's room matching lives; the browser gets the reworded lines.
 */
export function withReadLog(rec: TourRecord): TourRecord {
  const ctx = lineContext(rec.plan, (asked, room) => roomNameMatches(asked, room));
  return ctx ? { ...rec, log: rec.log.map((l) => readLine(l, ctx)) } : rec;
}

/** The Oct 30 re-run on the poster wall where the agent cleared check_plan's objections itself (Japanese Breakfast, 3 to none in one round). */
export const CLEARED_RERUN = "ipgunjvpgt";

/** That re-run in a few fields, read from its stored record; none unless the agent really cleared everything there.
 *  Dated in IST, as the loop versions are named on /how (this one ran on Oct 30). */
/** The same artist re-run with the current loop, for a tour routed before it (the flagship stays as the video shows it). */
export const SAME_ARTIST_RERUN: Record<string, string> = { "8v4ce57nx6": "d53j244bwp" };

/** That re-run as it came out, cleared or not (Oct 30 judges: publish it whatever it shows). */
export async function sameArtistRerun(id: string): Promise<(Rerun & { after: number; scout: number }) | undefined> {
  const rid = SAME_ARTIST_RERUN[id];
  const t = rid ? await loadTour(rid).catch(() => null) : null;
  const c = t?.engine?.check;
  if (!t?.plan || !c) return undefined;
  const date = new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Kolkata" });
  const scout = t.log.filter((l) => /\(scout_city, round \d+\)\.$/.test(l.text) && /^The agent asked to scout/.test(l.text)).length;
  return { id: t.id, artist: t.plan.artist.name, before: c.before, after: c.after, rounds: c.rounds, date, scout };
}

export async function clearedRerun(): Promise<Rerun | undefined> {
  const t = await loadTour(CLEARED_RERUN).catch(() => null);
  const c = t?.engine?.check;
  if (!t?.plan || !c || c.after !== 0 || !c.before) return undefined;
  const date = new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Kolkata" });
  const story = agentStory(t.log);
  return { id: t.id, artist: t.plan.artist.name, before: c.before, rounds: c.rounds, date, first: story?.first ?? [], rows: swapRows(t.log, t.plan.stops) };
}
