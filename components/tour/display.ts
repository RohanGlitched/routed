import type { FillLeg, RunLegs } from "@/lib/geo/fill";
import type { LogLine, Room, TourRecord } from "@/lib/types";

/**
 * Pure helpers for the tour book's display (no React), tested in test/display.test.ts: the stop strip's labels,
 * a guard on room capacities a room of that kind can't have, the call-sheet counts the page prints, and where the
 * street-level map's labels can go without covering each other.
 */

/** "5/6", as the poster prints a date. */
export const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

/** A stop as the stop strip names it: "5/6 Nashville". */
export const stripLabel = (s: { date: string; city: string }) => `${shortDate(s.date)} ${s.city}`;

/** The day sheet's anchor: stops count from 1, as the poster's rows do. */
export const stopAnchor = (i: number) => `stop-${i + 1}`;

/** Names that say the room is built for big crowds: no ceiling from the name. */
const BIG = /amphithe|arena|stadium|pavilion|\bcent(er|re)\b|\bpark\b|\bfield\b|\bbowl\b|fairground|coliseum|colosseum|\bdome\b|garden|speedway|racecourse|showground|\bforum\b/i;
/** Theatres, halls, auditoriums, ballrooms: none holds 10,000. */
const HALL = /theat(er|re)|\bhall\b|auditori|\bopera\b|playhouse|ballroom|\bchurch\b|\bchapel\b|cathedral/i;
/** Clubs, bars, rooms: none holds 3,000. */
const CLUB = /\bclub\b|\bbar\b|tavern|lounge|\bpub\b|caf[eé]|saloon|cellar|basement|\broom\b|studio|\bden\b|\bcave\b/i;

/** The most people a room of this kind can hold, read from its name; undefined when the name doesn't say. */
export function capacityCeiling(name: string): number | undefined {
  if (BIG.test(name)) return undefined;
  if (HALL.test(name)) return 10_000;
  if (CLUB.test(name)) return 3_000;
  return undefined;
}

/**
 * The capacity the day sheet may print for a room: none when the figure is impossible for the kind of room its
 * name says it is (a "Madison Theater" holding 17,556 is a stadium figure that slipped through a lookup).
 */
export function shownCapacity(room: Pick<Room, "name" | "capacity">): Room["capacity"] | undefined {
  const c = room.capacity;
  if (!c || !(c.value > 0)) return undefined;
  const cap = capacityCeiling(room.name);
  return cap !== undefined && c.value > cap ? undefined : c;
}

/** "Bogart's (holds 1,200)", "Musicians Corner (fan affinity 92)": every aside says what its number is. */
export function otherRoomLabel(r: Pick<Room, "name" | "capacity" | "affinity">): string {
  const c = shownCapacity(r);
  if (c) return `${r.name} (holds ${c.value.toLocaleString("en-US")})`;
  if (r.affinity !== undefined) return `${r.name} (fan affinity ${Math.round(r.affinity * 100)})`;
  return r.name;
}

/** Stored tours asked Qloo's weekly trend, which is flat for every artist on the hackathon host: not shown. */
export const shownLine = (l: LogLine) => !(l.kind === "qloo" && /^Is this audience growing\?$/.test(l.text));

/**
 * What the call sheet holds, by kind, as the footer counts it: lines shown, and of the Qloo lines how many carry
 * their exact request. The run's own tally (engine.usage.qloo) counts every request sent to Qloo, including the
 * place searches by name that a single line sums up, so it is the larger number.
 */
export function sheetCounts(log: LogLine[]): { qloo: number; withRequest: number; model: number; rule: number; web: number } {
  const shown = log.filter(shownLine);
  const q = shown.filter((l) => l.kind === "qloo");
  return {
    qloo: q.length,
    withRequest: q.filter((l) => l.request).length,
    model: shown.filter((l) => l.kind === "model").length,
    rule: shown.filter((l) => l.kind === "rule").length,
    web: shown.filter((l) => l.kind === "web").length,
  };
}

/** How the rules and the agent settled the booking, in one sentence (the counts /proof can total). */
export function checkLine(c: NonNullable<NonNullable<TourRecord["engine"]>["check"]>): string {
  const obj = (n: number) => `${n} objection${n === 1 ? "" : "s"}`;
  const first = c.before ? `The rules raised ${obj(c.before)} to the agent's booking${c.rounds ? `; it re-booked ${c.revised} pick${c.revised === 1 ? "" : "s"} in ${c.rounds} round${c.rounds === 1 ? "" : "s"}, leaving ${c.after ? obj(c.after) : "none"}` : ""}.` : "The agent's booking cleared every rule.";
  return `${first} ${c.ruled ? `A rule still changed ${c.ruled} of ${c.stops} stops.` : `Every stop is the agent's own.`}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/* ───────────── labels on the street-level map ───────────── */

export type MapLabel = { text: string; x: number; y: number; anchor: "start" | "end" | "middle"; box: [x0: number, y0: number, x1: number, y1: number] };

/**
 * Places each label beside its point (right, left, above, below, in that order) where it stays inside the square
 * and clear of the labels already placed and of `avoid` boxes; a label that fits nowhere is left out rather than
 * printed over another. Width is estimated from the text at `fs` px (Schibsted Grotesk runs about 0.56 em a letter).
 */
export function placeLabels(items: { text: string; x: number; y: number; gap?: number }[], size: number, fs = 10, avoid: MapLabel["box"][] = []): (MapLabel | null)[] {
  const taken: MapLabel["box"][] = [...avoid];
  const hit = (a: MapLabel["box"], b: MapLabel["box"]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  return items.map(({ text, x, y, gap = 6 }) => {
    const w = text.length * fs * 0.56;
    const h = fs * 1.2;
    const tries: MapLabel[] = [
      { text, x: x + gap, y: y + fs * 0.35, anchor: "start", box: [x + gap - 2, y - h / 2, x + gap + w + 2, y + h / 2] },
      { text, x: x - gap, y: y + fs * 0.35, anchor: "end", box: [x - gap - w - 2, y - h / 2, x - gap + 2, y + h / 2] },
      { text, x, y: y - gap - 2, anchor: "middle", box: [x - w / 2 - 2, y - gap - 2 - h, x + w / 2 + 2, y - gap + 1] },
      { text, x, y: y + gap + fs, anchor: "middle", box: [x - w / 2 - 2, y + gap - 1, x + w / 2 + 2, y + gap + fs + 3] },
    ];
    const ok = tries.find((t) => t.box[0] >= 2 && t.box[1] >= 2 && t.box[2] <= size - 2 && t.box[3] <= size - 2 && !taken.some((b) => hit(b, t.box)));
    if (!ok) return null;
    taken.push(ok.box);
    return ok;
  });
}

/** A label short enough for the map: the name up to its first comma or bracket, cut at a word near `max`. */
export function mapName(name: string, max = 22): string {
  const n = name.split(/[,(]/)[0]!.trim();
  if (n.length <= max) return n;
  const cut = n.slice(0, max + 1).replace(/\s+\S*$/, "");
  return `${(cut.length >= 6 ? cut : n.slice(0, max)).trim()}…`;
}

/* ───────────── the agent check, as a story ───────────── */

/** One check_plan objection in plain words: "Louisville sat inside Cincinnati's radius (145 km)". */
export function objectionPhrase(o: string): string {
  const t = o.trim();
  const rules: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^(.+?): not one of the city's rooms$/, (m) => `${m[1]}'s room wasn't one Qloo lists there`],
    [/^(.+?): ([\d,]+) km from (.+?) \(radius clause\)$/, (m) => `${m[1]} sat inside ${m[3]}'s radius (${m[2]} km)`],
    [/^(.+?): ([\d,]+) km leg from (.+)$/, (m) => `a ${m[2]} km leg from ${m[3]} to ${m[1]}`],
    [/^(.+?): (.+?) holds ([\d,]+), too (big|small)(?: \(a web figure, hand-checked at about ([\d,]+)\))?$/, (m) => (m[5] ? `${m[2]} too ${m[4]} for ${m[1]}, on a wrong web figure of ${m[3]} (hand-checked about ${m[5]})` : `${m[2]} too ${m[4]} for ${m[1]} (holds ${m[3]})`)],
    [/^(.+?): (.+?) has no confirmed capacity$/, (m) => `no confirmed capacity for ${m[2]} in ${m[1]}`],
    [/^(.+?): \1 is a major market, #(\d+) \(anchor rule\)$/, (m) => `${m[1]} missing, a major market and fan city #${m[2]}`],
    [/^(.+?): \1 is the hometown, #(\d+)$/, (m) => `${m[1]} missing, the hometown and fan city #${m[2]}`],
    [/^(.+?): \1 is fan city #(\d+) \(kept like an anchor\)$/, (m) => `${m[1]} missing, fan city #${m[2]}`],
    [/^(.+?): no room these fans go to could be measured for a crowd of ([\d,]+)$/, (m) => `no room in ${m[1]} measured for a crowd of ${m[2]}`],
    [/^(.+?): (.+?) \(([\d,]+)\) is a closer fit than (.+?)'s ([\d,]+)$/, (m) => `${m[2]} (${m[3]}) a closer fit in ${m[1]} than ${m[4]} (${m[5]})`],
  ];
  for (const [re, f] of rules) {
    const m = re.exec(t);
    if (m) return f(m);
  }
  return t;
}

/** "3 objections left: A; B; C" → ["A", "B", "C"]: only the "City: …" items, not the notes the loop adds after them. */
function objectionItems(s: string): string[] {
  return s
    .split(/;\s+/)
    .map((x) => x.trim())
    .filter((x) => /^[^:]{2,40}: \S/.test(x) && !/^as a whole|^that is no better/.test(x));
}

/** A rule that settled the booking after the agent's last answer, in a few words. */
function settledPhrase(l: LogLine): string | null {
  const t = l.text;
  let m: RegExpExecArray | null;
  if ((m = /^The agent booked (\d+) usable stops; the ranking filled the other (\d+)\.$/.exec(t))) return `the fan ranking filled ${m[2] === "1" ? "the stop" : `${m[2]} stops`} the agent left unusable${l.result ? ` (${l.result})` : ""}`;
  if ((m = /^(.+?) would cost a ([\d,]+) km leg with no show, so (.+?) \(#(\d+) on the fan map\) takes its place\.$/.exec(t))) return `${m[3]} (fan #${m[4]}) replaced ${m[1]}, a ${m[2]} km leg`;
  if ((m = /^(.+?) is where the tour starts and #(\d+) on .+?, so the run opens with a hometown show and (.+?) gives way\.$/.exec(t))) return `a hometown opener in ${m[1]}, so ${m[3]} gave way`;
  if ((m = /^(.+?) is #(\d+) on .+? fan map, but no route reaches it without a leg over ([\d,]+) km.*so it stays off this run\.$/.exec(t))) return `${m[1]} (fan #${m[2]}) stayed off: no route reaches it under ${m[3]} km`;
  if (/^One leg is still over ([\d,]+) km/.test(t)) return "one leg stays long, flagged on its day sheet";
  if ((m = /, so (.+?) gets (.+?)\.$/.exec(t))) return `${m[1]} gets ${m[2]}`;
  return null;
}

export type AgentStory = {
  /** check_plan's objections to the agent's first booking. */
  first: string[];
  rounds: { round: number; picks: string; left: string[] }[];
  /** The agent cleared every objection itself. */
  cleared: boolean;
  /** What the rules did after the agent's last answer. */
  settled: string[];
};

/**
 * The agent check as the call sheet logged it: what check_plan objected to, what each revision round left, and how
 * the rules settled the rest. Read from the stored lines, so every tour tells its own; null before the check existed.
 */
export function agentStory(log: LogLine[]): AgentStory | null {
  const i = log.findIndex((l) => l.kind === "rule" && /^check_plan:/.test(l.text));
  if (i < 0) return null;
  const firstLine = log[i]!;
  const first = /clears every rule/.test(firstLine.text) ? [] : objectionItems(firstLine.result ?? "").map(objectionPhrase);
  const rounds: AgentStory["rounds"] = [];
  let end = i;
  log.forEach((l, k) => {
    const m = l.kind === "model" ? /^The agent re-booked after the check \(round (\d+) of \d+\)\.$/.exec(l.text) : null;
    if (!m || k < i) return;
    end = k;
    const r = l.result ?? "";
    const picks = /^(No pick|\d+ picks?) changed/.exec(r)?.[1] ?? "";
    const left = /every rule clears/.test(r) ? [] : objectionItems(r.replace(/^.*?objections? left: /, "")).map(objectionPhrase);
    rounds.push({ round: Number(m[1]), picks: picks === "No pick" ? "no pick" : picks, left });
  });
  const last = rounds.at(-1);
  const cleared = first.length === 0 || (last ? last.left.length === 0 : false);
  const settled: string[] = [];
  for (const l of log.slice(end + 1)) {
    if (l.kind === "rule" && /^(Routed the shortest|Re-planned on city size|One support act)/.test(l.text)) break;
    if (l.kind !== "rule") continue;
    const p = settledPhrase(l);
    if (p) settled.push(p);
  }
  return { first, rounds, cleared, settled };
}

/** Tour-itinerary shorthand for the long city names, so all the stops fit the stop strip on a laptop. */
const STRIP_SHORT: Record<string, string> = {
  "Salt Lake City": "SLC",
  "San Francisco": "SF",
  "Los Angeles": "LA",
  "New York": "NYC",
  "Washington": "DC",
  "Philadelphia": "Philly",
  "Oklahoma City": "OKC",
  "Kansas City": "KC",
  "New Orleans": "NOLA",
  "Minneapolis": "Mpls",
  "Indianapolis": "Indy",
  "Albuquerque": "ABQ",
};

/** The stop strip's city: the shorthand where one is common, the city's own name otherwise. */
export const stripCity = (city: string) => STRIP_SHORT[city] ?? city;

/* ───────────── fill dates and legs (lib/geo/fill.ts) ───────────── */

/** One fill-date option: "Tulsa", "fan #61, adds 24 km, 5/11". */
export function fillOption(o: FillLeg["options"][number]): { city: string; note: string } {
  return { city: o.city, note: `fan #${o.fanRank}, ${o.addedKm < 10 ? "right on the way" : `adds ${o.addedKm.toLocaleString("en-US")} km`}, ${shortDate(o.date)}` };
}

/** What the options fill: "On the 2 dark days from Memphis, fan cities on the way:". */
export function fillLead(leg: FillLeg): string {
  if (leg.dayOff) return `The day off after ${leg.from} could be a show instead, in a fan city on the way:`;
  return `${leg.dark.length === 1 ? "The dark day" : `The ${leg.dark.length} dark days`} from ${leg.from} could carry a show, in a fan city on the way:`;
}

/** The day sheet's fill-date row as plain text (the tests, a screen reader's whole line). */
export function fillLine(leg: FillLeg): string {
  return `${fillLead(leg)} ${leg.options.map((o) => { const x = fillOption(o); return `${x.city} (${x.note})`; }).join(", ")}.`;
}

const LEG_WORDS = ["", "One", "Two", "Three", "Four", "Five"];

/** "Two legs: Southeast (Nashville to Memphis), then West (Denver to Seattle)." */
export function legsLead(r: RunLegs): string {
  const n = LEG_WORDS[r.legs.length] ?? String(r.legs.length);
  const part = (l: RunLegs["legs"][number]) => {
    const span = l.first === l.last ? l.first : `${l.first} to ${l.last}`;
    return l.region ? `${l.region} (${span})` : span;
  };
  return `${n} legs: ${r.legs.map(part).join(", then ")}.`;
}

/** "Memphis to Denver is 1,694 km, about 19.9 h: 2 travel days in the van, or fly the band and send the backline." */
export function jumpLine(j: RunLegs["jumps"][number]): string {
  return `${j.from} to ${j.to} is ${j.km.toLocaleString("en-US")} km, about ${j.hours} h: ${j.travelDays} travel days in the van, or fly the band and send the backline.`;
}

/** Every jump between legs in one sentence: the one-jump line, or each jump with its days and one way to play them. */
export function jumpsLine(r: RunLegs): string {
  if (r.jumps.length === 1) return jumpLine(r.jumps[0]!);
  const each = r.jumps.map((j) => `${j.from} to ${j.to}, ${j.km.toLocaleString("en-US")} km (about ${j.hours} h, ${j.travelDays} travel days)`);
  return `The jumps between them: ${each.slice(0, -1).join(", ")} and ${each.at(-1)}. Drive them in the van, or fly the band and send the backline.`;
}
