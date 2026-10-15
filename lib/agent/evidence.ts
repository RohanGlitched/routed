import type { Opener, Plan, Room, Stop } from "../types";
import { addDays } from "../geo/route";
import { AGE_LABEL, topAge } from "./audience";

/**
 * The facts a pitch may use, as plain lines. The model writes from these and nothing else; afterwards every
 * number in what it wrote must appear in these lines, or it is struck (Playbook K4: check facts deterministically).
 */

export const pct = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 100));

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2027-03-12" → "Friday, March 12". */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** How a room's known capacity compares with the usual crowd: 60% to 250% of the draw fits. */
export function fit(r: Room, draw?: number): "fits" | "too small" | "too big" | "unknown" {
  if (!draw || !r.capacity) return "unknown";
  if (r.capacity.value < draw * 0.6) return "too small";
  if (r.capacity.value > draw * 2.5) return "too big";
  return "fits";
}

export const room = (s: Stop): Room | undefined => s.rooms.find((r) => r.id === s.roomId) ?? s.rooms[0];
export const opener = (s: Stop): Opener | undefined => s.openers.find((o) => o.id === s.openerId) ?? s.openers[0];

/** Every night of a stop, as ISO dates: a two-night stand on 2027-05-07 plays 2027-05-07 and 2027-05-08. */
export const showNights = (s: Pick<Stop, "date" | "nights">): string[] => Array.from({ length: Math.max(1, s.nights ?? 1) }, (_, i) => addDays(s.date, i));

export function evidenceLines(plan: Plan, s: Stop, draw?: number): string[] {
  const r = room(s);
  const o = opener(s);
  const top = topAge(plan.audience.age);
  const lines = [
    `Artist: ${plan.artist.name}${plan.artist.genres.length ? ` (${plan.artist.genres.slice(0, 3).join(", ")})` : ""}`,
    (s.nights ?? 1) > 1 ? `Dates asked for: ${showNights(s).length === 2 ? "two" : showNights(s).length} nights, ${showNights(s).map((d) => `${longDate(d)} (${d})`).join(" and ")}` : `Date asked for: ${longDate(s.date)} (${s.date})`,
    `City: ${s.label}. Of the ${plan.cities.length} cities where Qloo found ${plan.artist.name} fans in this region, ${s.city} ranks ${s.score.rank} for fan affinity.`,
    `Qloo fan-affinity score for ${s.city}: ${pct(s.score.affinity)} out of 100${s.score.popularity !== undefined ? `; popularity percentile ${pct(s.score.popularity)}` : ""}.`,
  ];
  if (r) {
    lines.push(`Room: ${r.name}${r.address ? `, ${r.address}` : ""}.`);
    if (r.affinity !== undefined) lines.push(`Qloo affinity between ${plan.artist.name} fans and ${r.name}: ${pct(r.affinity)} out of 100.`);
    if (r.capacity) {
      const f = draw ? fit(r, draw) : "unknown";
      lines.push(`${r.name} capacity: ${r.capacity.value} (from ${r.capacity.source}).${(s.nights ?? 1) > 1 && f === "too small" ? ` One night is small for the usual crowd of about ${draw}, so ask for two nights; don't call the room a fit for one.` : f === "too small" ? ` That is small for the usual crowd of about ${draw}: ask whether a second night or a larger room is possible, and don't call the room a fit.` : f === "too big" ? ` That is large for the usual crowd of about ${draw}: ask about a reduced configuration, and don't call the room a fit.` : f === "fits" ? ` That fits the usual crowd of about ${draw}.` : ""}`);
    } else if (draw) lines.push(`${r.name}'s capacity isn't confirmed; the usual crowd is about ${draw}. Ask the room what it holds.`);
  }
  if (s.local?.hot && r) {
    const where = s.local.hot.name ? `${s.local.hot.name}${s.local.hot.trait ? `, ${s.local.hot.trait.toLowerCase()}` : ""}` : "one neighbourhood";
    const km = s.local.roomKm ?? 0;
    lines.push(km <= 1.5 ? `Qloo's street-level heatmap puts ${plan.artist.name} fans' strongest area in ${s.city} at ${where}, and ${r.name} sits in it.` : s.local.inHot ? `Qloo's street-level heatmap puts ${plan.artist.name} fans' strongest area in ${s.city} at ${where}; ${r.name} sits on one of their strongest tiles, ${km} km from it.` : `Qloo's street-level heatmap puts ${plan.artist.name} fans' strongest area in ${s.city} at ${where}; ${r.name} is ${km} km from it.`);
  }
  if (o) lines.push(`Support act for the whole run (travelling with the tour): ${o.name}${o.affinity !== undefined ? `, Qloo audience affinity ${pct(o.affinity)} out of 100 with ${plan.artist.name}` : ""}${o.shared.length ? `; shared tastes: ${o.shared.slice(0, 3).join(", ")}` : ""}.`);
  if (top) lines.push(`Audience: Qloo says ${plan.artist.name} fans over-index most at ages ${AGE_LABEL[top.bucket]}.`);
  const t = plan.audience.taste;
  if (t?.music?.length) lines.push(`The sound these fans love (Qloo taste analysis): ${t.music.slice(0, 4).map((x) => x.name).join(", ")}.`);
  if (t?.vibe?.length) lines.push(`How these fans describe the music they love: ${t.vibe.slice(0, 3).map((x) => x.name.toLowerCase()).join(", ")}.`);
  if (!t && plan.audience.tags.length) lines.push(`What these fans also love (Qloo taste analysis): ${plan.audience.tags.slice(0, 5).map((x) => x.name).join(", ")}.`);
  if (s.after.length) lines.push(`Where these fans go out in ${s.city} (Qloo): ${s.after.slice(0, 2).map((a) => a.name).join(", ")}.`);
  const trend = plan.audience.trend;
  if (trend.length >= 2) {
    const a = trend[0]!.percentile, b = trend.at(-1)!.percentile;
    if (a !== undefined && b !== undefined) lines.push(`Qloo popularity percentile for ${plan.artist.name}: ${Math.round(a)} on ${trend[0]!.date}, ${Math.round(b)} on ${trend.at(-1)!.date}.`);
  }
  return lines;
}

/**
 * Numbers as written: "1,200", "12", "3.5", "100", "15k" (fifteen thousand). A comma after a number ("May 9, 2027")
 * is punctuation, and "3km" is a distance, not thousands. Ordinals and years count as numbers too.
 */
const NUM = /\d(?:[\d,]*\d)?(?:\.\d+)?(?:k(?![a-z]))?/gi;

const norm = (n: string) => {
  const k = /k$/i.test(n);
  const v = n.replace(/k$/i, "").replace(/,/g, "").replace(/\.0+$/, "");
  return k ? String(Math.round(Number(v) * 1000)) : v;
};

/** Text with any earlier strike marks taken off ("~~8~~" → "8", "~~~~8~~~~" → "8"), so a check can run again. */
export const unstrike = (t: string) => t.replace(/~{2,}([^~]+?)~{2,}/g, "$1");

/**
 * Returns the text with every number that isn't in the evidence wrapped in ~~ ~~, and the list of what was
 * struck. A date written "March 12" passes because 12 is in the evidence; "2,000 tickets" doesn't unless 2000 is.
 * Idempotent: earlier strike marks are taken off first, so checking twice never wraps a figure twice.
 */
export function checkNumbers(text: string, evidence: string[]): { text: string; struck: string[] } {
  const allowed = new Set<string>();
  for (const line of evidence) for (const m of unstrike(line).match(NUM) ?? []) {
    allowed.add(norm(m));
    // "2027-03-12" also allows "03" → "3".
    allowed.add(String(Number(norm(m))));
  }
  const struck: string[] = [];
  const out = unstrike(text).replace(NUM, (m) => {
    const n = norm(m);
    if (allowed.has(n) || allowed.has(String(Number(n)))) return m;
    struck.push(m);
    return `~~${m}~~`;
  });
  return { text: out, struck };
}

/** Checks a stored pitch again against its stop's evidence as the evidence reads now. No model call. */
export function recheckPitch(pitch: { subject: string; body: string }, evidence: string[]): { subject: string; body: string; struck: string[] } {
  const subject = checkNumbers(pitch.subject, evidence);
  const body = checkNumbers(pitch.body, evidence);
  return { subject: subject.text, body: body.text, struck: [...subject.struck, ...body.struck] };
}

/**
 * What the booking model was shown for this stop's city when it wrote the stop's "why" (plan.ts: the heatmap row,
 * every candidate room with its affinity, popularity and capacity, every candidate support act's affinity, the
 * usual crowd), on top of the pitch evidence. A "why" may cite any of these; anything else is struck.
 */
export function whyEvidence(plan: Plan, s: Stop, draw?: number): string[] {
  const n = (v?: number) => (v === undefined ? "" : String(Math.round(v * 100)));
  return [
    ...evidenceLines(plan, s, draw),
    `Heatmap row: ${s.city} #${s.score.rank}, affinity ${n(s.score.affinity)}${s.score.popularity !== undefined ? `, signal ${n(s.score.popularity)}` : ""}.`,
    ...s.rooms.map((r) => `Room candidate ${r.name}: affinity ${n(r.affinity)}, popularity ${n(r.popularity)}${r.capacity ? `, capacity ${r.capacity.value}` : ""}.`),
    ...s.openers.map((o) => `Support candidate ${o.name}: affinity ${n(o.affinity)}.`),
    ...(draw ? [`Usual crowd: about ${draw}.`] : []),
  ];
}

/**
 * The plain sentence a rule writes when it changes a stop's room (plan.ts, resize.ts): the city's rank, and what the
 * room holds or how well it matches. Rebuilt from the stop as it stands, so a capacity measured later is the one shown.
 */
export function ruleWhy(artist: string, s: Pick<Stop, "city" | "score" | "nights">, r: Room): string {
  return `${s.city} is ${artist}'s #${s.score.rank} city on Qloo${r.capacity ? `, and ${r.name} holds ${r.capacity.value.toLocaleString("en-US")}${s.nights === 2 ? " a night over two nights" : ""}` : `, and ${r.name} matches these fans at ${Math.round((r.affinity ?? 0) * 100)}`}.`;
}

const RULE_WHY = /^.+ is .+'s #\d+ city on Qloo, and .+ (holds [~\d,]+( a night over two nights)?|matches these fans at [~\d]+)\.$/;

/** A stop's "why", checked: a rule's sentence is rebuilt from the stop first; the model's is checked as written. */
export function checkWhy(plan: Plan, s: Stop, draw?: number): string | undefined {
  if (!s.why) return s.why;
  const r = room(s);
  const text = r && RULE_WHY.test(unstrike(s.why)) && unstrike(s.why).includes(r.name) ? ruleWhy(plan.artist.name, s, r) : s.why;
  return checkNumbers(text, whyEvidence(plan, s, draw)).text;
}

/** A plain pitch from the evidence alone, for when the model is off or out of budget. */
export function templatePitch(plan: Plan, s: Stop): { subject: string; body: string } {
  const r = room(s);
  const o = opener(s);
  const top = topAge(plan.audience.age);
  const day = longDate(s.date);
  const body = [
    `Hi${r ? ` ${r.name} team` : ""},`,
    "",
    `I'm routing ${plan.artist.name} through ${s.city} and would love a hold on ${(s.nights ?? 1) > 1 ? `two nights from ${day}` : day}${r ? ` at ${r.name}` : ""}.`,
    "",
    `Why ${s.city}: on Qloo's taste graph, ${s.city} ranks ${s.score.rank} of ${plan.cities.length} cities in the region for ${plan.artist.name} fan affinity (score ${pct(s.score.affinity)} out of 100).` +
      (r?.affinity !== undefined ? ` Their fans' affinity with ${r.name} itself scores ${pct(r.affinity)}.` : ""),
    ...(top ? [`The audience over-indexes at ages ${AGE_LABEL[top.bucket]}.`] : []),
    ...(o ? [`${o.name} is the support act on every date${o.shared.length ? "" : "."}${o.shared.length ? `; the two audiences share a taste for ${o.shared.slice(0, 2).join(" and ").toLowerCase()}.` : ""}`] : []),
    "",
    "Could you let me know about availability and your offer terms?",
    "",
    "Thanks,",
  ].join("\n");
  return { subject: `Hold request: ${plan.artist.name}, ${day}`, body };
}
