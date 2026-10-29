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

/** What the stored plan says about each stop's rooms, for rewording a line against what was finally booked. */
export type LineContext = {
  stops: { city: string; booked?: string; rooms: { name: string; capacity?: number; checked?: boolean }[] }[];
  /** Whether a name someone asked for is this room. The tour page passes lib/agent/plan.ts roomNameMatches (with
   *  its operator prefixes stripped); the default is the same name, ignoring case. */
  same?: (asked: string, room: string) => boolean;
};

/** A line as the call sheet prints it; `check` is set on a web capacity the stored plan's hand check overturned. */
export type ReadLine = LogLine & { check?: { text: string; wrong: boolean } };

/** A web figure twice the hand-checked one (or half) is wrong for the room, not another configuration of it. */
export const WRONG_RATIO = 2;

const num = (s: string) => Number(s.replace(/,/g, ""));
const fmt = (n: number) => n.toLocaleString("en-US");
const plain = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The one room of this name with a hand-checked capacity across the tour; none when two such rooms disagree. */
function checkedRoom(ctx: LineContext, name: string, city?: string): { name: string; capacity: number } | null {
  const hits = ctx.stops
    .filter((s) => !city || plain(s.city, city))
    .flatMap((s) => s.rooms)
    .filter((r) => r.checked && r.capacity && plain(r.name, name));
  const caps = new Set(hits.map((r) => r.capacity));
  return hits.length && caps.size === 1 ? { name: hits[0]!.name, capacity: hits[0]!.capacity! } : null;
}

/** "Madison Theater holds 17,556, too big" with the hand-checked figure beside it, where they disagree. */
export function objectionWithCheck(text: string, ctx?: LineContext, city?: string): string {
  if (!ctx) return text;
  return text.replace(/([^:;]+?) holds ([\d,]+), too (big|small)/g, (all, room: string, n: string) => {
    const c = checkedRoom(ctx, room.trim(), city);
    if (!c || c.capacity === num(n)) return all;
    return `${all} (a web figure, hand-checked at about ${fmt(c.capacity)})`;
  });
}

export function readLine(l: LogLine, ctx?: LineContext): ReadLine {
  let out: ReadLine = l;
  for (const [from, to, extra] of REWORDED) {
    if (from.test(l.text)) {
      out = { ...l, ...(extra?.failed === false ? { failed: undefined } : {}), text: l.text.replace(from, to) };
      break;
    }
  }
  // Qloo's tag names as stored ("Alt- country", "Indie - Folk") read the way the tour book prints them.
  if (out.result && /\b[A-Za-z]+(- | - )[A-Za-z]/.test(out.result)) out = { ...out, result: out.result.replace(/\b([A-Za-z]+)- ([a-z])/g, "$1-$2").replace(/\b([A-Z][a-z]+) - ([A-Z])([a-z]+)\b/g, (_m, a: string, b: string, c: string) => `${a} ${b.toLowerCase()}${c}`) };
  if (!ctx) return out;
  const same = ctx.same ?? plain;

  // A room the agent named that Qloo's search by name missed, but the city's own list held under another name.
  const sug = /^The agent suggested (.+) in (.+); Qloo's place search didn't return it there, so it isn't booked\.$/.exec(out.text);
  if (sug) {
    const [, asked, city] = sug as unknown as [string, string, string];
    const stop = ctx.stops.find((s) => plain(s.city, city));
    if (stop?.booked && same(asked, stop.booked)) return { ...out, failed: undefined, text: `The agent suggested ${asked} in ${city}; found on Qloo as ${stop.booked}, and booked.` };
    const listed = stop?.rooms.find((r) => same(asked, r.name));
    if (listed) return { ...out, failed: undefined, text: `The agent suggested ${asked} in ${city}; found on Qloo as ${listed.name}, on the city's list.` };
    return out;
  }

  // The summary of those searches lists the same room as not found: say where the city's list has it.
  const nf = out.kind === "qloo" && out.result ? /^(.*not found: )(.+)$/.exec(out.result) : null;
  if (nf) {
    const items = nf[2]!.split(", ").map((item) => {
      const m = /^(.+) in (.+)$/.exec(item);
      const stop = m ? ctx.stops.find((x) => plain(x.city, m[2]!)) : undefined;
      const hit = m && stop ? stop.rooms.find((r) => same(m[1]!, r.name)) : undefined;
      return hit ? `${item} (on the city's list as ${hit.name})` : item;
    });
    return { ...out, result: `${nf[1]}${items.join(", ")}` };
  }

  // A web capacity the hand check overturned: shown, and marked.
  const ask = out.kind === "web" ? /^How many does (.+) hold\?$/.exec(out.text) : null;
  const got = ask && out.result ? /^([\d,]+), per /.exec(out.result) : null;
  if (ask && got) {
    const c = checkedRoom(ctx, ask[1]!);
    const n = num(got[1]!);
    if (c && c.capacity !== n) {
      const wrong = Math.max(n, c.capacity) / Math.min(n, c.capacity) >= WRONG_RATIO;
      return { ...out, check: { wrong, text: wrong ? `Rejected: wrong for this room; the hand-checked figure is about ${fmt(c.capacity)}.` : `The hand-checked figure, about ${fmt(c.capacity)}, replaces it.` } };
    }
    return out;
  }

  // check_plan's objections that rest on a web figure the hand check overturned, in the result and in the swaps.
  const big = / holds [\d,]+, too (big|small)/;
  if ((out.result && big.test(out.result)) || out.swaps?.some((sw) => big.test(sw.objection))) {
    const swaps = out.swaps?.map((sw) => ({ ...sw, objection: objectionWithCheck(sw.objection, ctx) }));
    out = { ...out, ...(out.result ? { result: objectionWithCheck(out.result, ctx) } : {}), ...(swaps ? { swaps } : {}) };
  }
  // A rule's "Bogart's holds 1,200" from before the hand check.
  const held = out.kind === "rule" && out.result ? /^(.+?) holds ([\d,]+)$/.exec(out.result) : null;
  if (held) {
    const c = checkedRoom(ctx, held[1]!);
    if (c && c.capacity !== num(held[2]!)) out = { ...out, result: `${out.result} (hand-checked since at about ${fmt(c.capacity)})` };
  }
  return out;
}

/** The stored plan's rooms, as readLine reads them: the booked one per city, and each with a hand-checked size. */
export function lineContext(plan: { stops?: { city: string; roomId?: string; rooms: { id: string; name: string; capacity?: { value: number; quote?: string } }[] }[] } | undefined, same?: LineContext["same"]): LineContext | undefined {
  if (!plan?.stops?.length) return undefined;
  return {
    stops: plan.stops.map((s) => ({
      city: s.city,
      booked: s.rooms.find((r) => r.id === s.roomId)?.name,
      rooms: s.rooms.map((r) => ({ name: r.name, capacity: r.capacity?.value, checked: /checked by hand/i.test(r.capacity?.quote ?? "") })),
    })),
    ...(same ? { same } : {}),
  };
}
