import type { TourRecord } from "../types";
import { checkWhy, evidenceLines, garbled, recheckPitch, templatePitch } from "./evidence";

const marks = (t?: string) => (t?.match(/~{2,}[^~]+?~{2,}/g) ?? []).length;

/**
 * Checks a stored tour's figures again under the current checker, with no model or Qloo call: every hold request
 * against its stop's evidence (one that reads as broken, garbled in evidence.ts, is re-drafted from the template),
 * and every stop's "why" rebuilt from the rule's sentence and checked against what the booking model was shown.
 * Returns the record unchanged when nothing moves; otherwise the new record with one call-sheet line saying what
 * changed.
 */
export function recheckTour(rec: TourRecord, at = new Date().toISOString()): { rec: TourRecord; before: number; after: number; changed: string[]; redrafted: string[] } {
  if (!rec.plan?.stops?.length) return { rec, before: 0, after: 0, changed: [], redrafted: [] };
  const plan = structuredClone(rec.plan);
  const draw = rec.input.draw;
  let before = 0;
  let after = 0;
  const changed: string[] = [];
  const redrafted: string[] = [];
  for (const s of plan.stops) {
    let moved = false;
    if (s.pitch) {
      const broken = garbled(`${s.pitch.subject}\n${s.pitch.body}`).length > 0;
      const next = broken ? { ...templatePitch(plan, s, { draw }), struck: [] } : recheckPitch(s.pitch, evidenceLines(plan, s, draw));
      if (broken) redrafted.push(s.city);
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
  if (!changed.length) return { rec, before, after, changed, redrafted };
  const line = {
    at,
    kind: "rule" as const,
    text: `Re-checked every figure in the hold requests and the stops' reasons against the evidence as it reads now: a two-night stand names both dates, every stop's reason is the rule's sentence for the room as measured${redrafted.length ? `, and a hold request that read as broken was re-drafted from the template` : ""}.`,
    result: `${changed.join(", ")}: ${before} struck before, ${after} now${redrafted.length ? `; re-drafted ${redrafted.join(", ")}` : ""}`,
  };
  return { rec: { ...rec, plan, log: [...rec.log, line] }, before, after, changed, redrafted };
}
