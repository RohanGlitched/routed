import type { TourRecord } from "../types";
import { checkWhy, evidenceLines, recheckPitch } from "./evidence";

const marks = (t?: string) => (t?.match(/~{2,}[^~]+?~{2,}/g) ?? []).length;

/**
 * Checks a stored tour's figures again under the current checker, with no model or Qloo call: every hold request
 * against its stop's evidence, and every stop's "why" against what the booking model was shown (a rule's sentence
 * rebuilt from the stop first). Returns the record unchanged when nothing moves; otherwise the new record with one
 * call-sheet line saying what changed.
 */
export function recheckTour(rec: TourRecord, at = new Date().toISOString()): { rec: TourRecord; before: number; after: number; changed: string[] } {
  if (!rec.plan?.stops?.length) return { rec, before: 0, after: 0, changed: [] };
  const plan = structuredClone(rec.plan);
  const draw = rec.input.draw;
  let before = 0;
  let after = 0;
  const changed: string[] = [];
  for (const s of plan.stops) {
    let moved = false;
    if (s.pitch) {
      const next = recheckPitch(s.pitch, evidenceLines(plan, s, draw));
      before += s.pitch.struck.length;
      after += next.struck.length;
      if (next.subject !== s.pitch.subject || next.body !== s.pitch.body) moved = true;
      s.pitch = next;
    }
    if (s.why) {
      const next = checkWhy(plan, s, draw);
      before += marks(s.why);
      after += marks(next);
      if (next !== s.why) moved = true;
      s.why = next;
    }
    if (moved) changed.push(s.city);
  }
  if (!changed.length) return { rec, before, after, changed };
  const line = {
    at,
    kind: "rule" as const,
    text: `Re-checked every figure in the hold requests and the stops' reasons against the evidence as it reads now: a two-night stand names both dates, and a rule's sentence uses the room as measured.`,
    result: `${changed.join(", ")}: ${before} struck before, ${after} now`,
  };
  return { rec: { ...rec, plan, log: [...rec.log, line] }, before, after, changed };
}
