import type { LogLine } from "./types";

/**
 * Call-sheet wording that changed after tours were stored. Tours booked before Oct 15 logged "a room and an opener
 * in each"; every tour now carries one support act for the whole run, so stored lines read the current way.
 */
const REWORDED: [RegExp, string][] = [[/^Booked (\d+) stops: a room and an opener in each\.$/, "Booked $1 stops: a room in each, and one support act for the run."]];

export function readLine(l: LogLine): LogLine {
  for (const [from, to] of REWORDED) if (from.test(l.text)) return { ...l, text: l.text.replace(from, to) };
  return l;
}
