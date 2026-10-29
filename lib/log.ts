import type { LogLine } from "./types";

/**
 * Call-sheet wording that changed after tours were stored. Tours booked before Oct 15 logged "a room and an opener
 * in each"; every tour now carries one support act for the whole run, so stored lines read the current way.
 */
const REWORDED: [RegExp, string, { failed?: false }?][] = [
  [/^Booked (\d+) stops: a room and an opener in each\.$/, "Booked $1 stops: a room in each, and one support act for the run."],
  // Before Oct 30 a name Qloo's place search didn't return read as a red failure, even when the city's list had the
  // room under an operator's name ("Crystal Ballroom" is McMenamins Crystal Ballroom).
  [/^The agent suggested (.+) in (.+); Qloo has no such room here\.$/, "The agent suggested $1 in $2; Qloo's place search didn't return it there, so it isn't booked.", { failed: false }],
  [/^Wikidata lists (.+) in (.+) \(holds ([\d,]+)\); Qloo has no such room here\.$/, "Wikidata lists $1 in $2 (holds $3); Qloo's place search didn't return it there, so it isn't booked.", { failed: false }],
];

export function readLine(l: LogLine): LogLine {
  for (const [from, to, extra] of REWORDED) if (from.test(l.text)) return { ...l, ...(extra?.failed === false ? { failed: undefined } : {}), text: l.text.replace(from, to) };
  return l;
}
