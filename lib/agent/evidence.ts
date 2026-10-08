import type { Opener, Plan, Room, Stop } from "../types";
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

export function evidenceLines(plan: Plan, s: Stop, draw?: number): string[] {
  const r = room(s);
  const o = opener(s);
  const top = topAge(plan.audience.age);
  const lines = [
    `Artist: ${plan.artist.name}${plan.artist.genres.length ? ` (${plan.artist.genres.slice(0, 3).join(", ")})` : ""}`,
    `Date asked for: ${longDate(s.date)} (${s.date})`,
    `City: ${s.label}. Of the ${plan.cities.length} cities where Qloo found ${plan.artist.name} fans in this region, ${s.city} ranks ${s.score.rank} for fan affinity.`,
    `Qloo fan-affinity score for ${s.city}: ${pct(s.score.affinity)} out of 100${s.score.popularity !== undefined ? `; popularity percentile ${pct(s.score.popularity)}` : ""}.`,
  ];
  if (r) {
    lines.push(`Room: ${r.name}${r.address ? `, ${r.address}` : ""}.`);
    if (r.affinity !== undefined) lines.push(`Qloo affinity between ${plan.artist.name} fans and ${r.name}: ${pct(r.affinity)} out of 100.`);
    if (r.capacity) {
      const f = draw ? fit(r, draw) : "unknown";
      lines.push(`${r.name} capacity: ${r.capacity.value} (from ${r.capacity.source}).${f === "too small" ? ` That is small for the usual crowd of about ${draw}: ask whether a second night or a larger room is possible, and don't call the room a fit.` : f === "too big" ? ` That is large for the usual crowd of about ${draw}: ask about a reduced configuration, and don't call the room a fit.` : f === "fits" ? ` That fits the usual crowd of about ${draw}.` : ""}`);
    } else if (draw) lines.push(`${r.name}'s capacity isn't confirmed; the usual crowd is about ${draw}. Ask the room what it holds.`);
  }
  if (s.local?.hot && r) {
    const where = s.local.hot.name ? `${s.local.hot.name}${s.local.hot.trait ? `, ${s.local.hot.trait.toLowerCase()}` : ""}` : "one neighbourhood";
    const km = s.local.roomKm ?? 0;
    lines.push(km <= 1.5 ? `Qloo's street-level heatmap puts ${plan.artist.name} fans' strongest area in ${s.city} at ${where}, and ${r.name} sits in it.` : s.local.inHot ? `Qloo's street-level heatmap puts ${plan.artist.name} fans' strongest area in ${s.city} at ${where}; ${r.name} sits on one of their strongest tiles, ${km} km from it.` : `Qloo's street-level heatmap puts ${plan.artist.name} fans' strongest area in ${s.city} at ${where}; ${r.name} is ${km} km from it.`);
  }
  if (o) lines.push(`Suggested opener: ${o.name}${o.affinity !== undefined ? `, Qloo audience affinity ${pct(o.affinity)} out of 100 with ${plan.artist.name}` : ""}${o.shared.length ? `; shared tastes: ${o.shared.slice(0, 3).join(", ")}` : ""}.`);
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

/** Numbers as written: "1,200", "12", "3.5", "100". Ordinals and years count as numbers too. */
const NUM = /\d[\d,]*(?:\.\d+)?/g;

const norm = (n: string) => n.replace(/,/g, "").replace(/\.0+$/, "");

/**
 * Returns the text with every number that isn't in the evidence wrapped in ~~ ~~, and the list of what was
 * struck. A date written "March 12" passes because 12 is in the evidence; "2,000 tickets" doesn't unless 2000 is.
 */
export function checkNumbers(text: string, evidence: string[]): { text: string; struck: string[] } {
  const allowed = new Set<string>();
  for (const line of evidence) for (const m of line.match(NUM) ?? []) {
    allowed.add(norm(m));
    // "2027-03-12" also allows "03" → "3".
    allowed.add(String(Number(norm(m))));
  }
  const struck: string[] = [];
  const out = text.replace(NUM, (m) => {
    const n = norm(m);
    if (allowed.has(n) || allowed.has(String(Number(n)))) return m;
    struck.push(m);
    return `~~${m}~~`;
  });
  return { text: out, struck };
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
    `I'm routing ${plan.artist.name} through ${s.city} and would love a hold on ${day}${r ? ` at ${r.name}` : ""}.`,
    "",
    `Why ${s.city}: on Qloo's taste graph, ${s.city} ranks ${s.score.rank} of ${plan.cities.length} cities in the region for ${plan.artist.name} fan affinity (score ${pct(s.score.affinity)} out of 100).` +
      (r?.affinity !== undefined ? ` Their fans' affinity with ${r.name} itself scores ${pct(r.affinity)}.` : ""),
    ...(top ? [`The audience over-indexes at ages ${AGE_LABEL[top.bucket]}.`] : []),
    ...(o ? [`For support we're looking at ${o.name}${o.shared.length ? `, whose fans share a taste for ${o.shared.slice(0, 2).join(" and ")}` : ""}.`] : []),
    "",
    "Could you let me know about availability and your offer terms?",
    "",
    "Thanks,",
  ].join("\n");
  return { subject: `Hold request: ${plan.artist.name}, ${day}`, body };
}
