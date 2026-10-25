import type { Opener, Plan, Room, Stop } from "../types";
import { localEvidence, readLocal, type LocalRead } from "../geo/local";
import { addDays } from "../geo/route";
import { AGE_LABEL, topAge } from "./audience";
import { sharedGenres } from "./rooms";

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

/** "2027-03-12" → "Friday, March 12, 2027": a buyer files holds by year. */
export const fullDate = (iso: string) => `${longDate(iso)}, ${iso.slice(0, 4)}`;

/**
 * How a room's known capacity compares with the usual crowd, for booking: 60% to 250% of the draw can be booked
 * for one night. The word "fits" in copy is narrower (snugFit, sizeNote).
 */
export function fit(r: Room, draw?: number): "fits" | "too small" | "too big" | "unknown" {
  if (!draw || !r.capacity) return "unknown";
  if (r.capacity.value < draw * 0.6) return "too small";
  if (r.capacity.value > draw * 2.5) return "too big";
  return "fits";
}

/** A page or a pitch says a room "fits" only from 85% to 130% of the usual crowd ("the 1,270-capacity room fits the
 *  usual crowd of about 1,500" read as false to a booker). */
export const SNUG = { min: 0.85, max: 1.3 };
export const snugFit = (capacity: number, draw: number) => capacity >= draw * SNUG.min && capacity <= draw * SNUG.max;

const n0 = (v: number) => v.toLocaleString("en-US");
const NIGHTS_WORD = ["", "One night", "Two nights", "Three nights", "Four nights"];

/**
 * The day sheet's sentence on a room's size against the usual crowd, by rule. "Fits" only at 85–130% for one
 * night; "cover" only when the nights together hold the crowd; otherwise what the room holds of it. `kind` says
 * what the sentence is; `alarm` whether the page shows it as a warning: only a misfit (one night under half the
 * crowd, two nights short of it, or over 2.5 times it). A room inside the booking window (60–250%) is never one.
 */
export function sizeNote(capacity: number, draw: number, nights = 1): { text: string; kind: "fits" | "covers" | "short" | "large"; alarm: boolean } {
  const crowd = n0(draw);
  if (nights > 1) {
    const all = capacity * nights;
    const word = NIGHTS_WORD[nights] ?? `${nights} nights`;
    return all >= draw
      ? { text: `${word} cover a usual crowd of ${crowd} (${n0(all)} across ${nights === 2 ? "both" : "them"}): no room these fans go to here was confirmed to fit it in one.`, kind: "covers", alarm: false }
      : { text: `${word} hold ${n0(all)} of a usual crowd of ${crowd}: no room these fans go to here was confirmed to fit it in one.`, kind: "short", alarm: true };
  }
  if (snugFit(capacity, draw)) return { text: `Fits a usual crowd of ${crowd}.`, kind: "fits", alarm: false };
  if (capacity < draw * 0.6) return { text: `Holds ${n0(capacity)} of a usual crowd of ${crowd}: no room these fans go to here was confirmed to fit, so the pitch asks about a second night or a bigger room.`, kind: "short", alarm: capacity < draw * 0.5 };
  if (capacity < draw) return { text: `Holds ${n0(capacity)} of a usual crowd of ${crowd} in one night.`, kind: "short", alarm: false };
  if (capacity > draw * 2.5) return { text: `Holds ${n0(capacity)} against a usual crowd of ${crowd}: no room these fans go to here was confirmed to fit, so the pitch asks about a reduced configuration.`, kind: "large", alarm: true };
  return { text: `Room for ${n0(capacity)} against a usual crowd of ${crowd}.`, kind: "large", alarm: false };
}

/** The day sheet's line for a room nobody could measure: a warning from a crowd of 1,000 up, where a guess can be
 *  a 100-cap bar; plain below it, where most clubs aren't on Wikidata and the pitch asks. */
export function unmeasuredNote(draw?: number): { text: string; alarm: boolean } {
  return { text: "Capacity not found on the web; ask the room.", alarm: Boolean(draw && draw >= 1000) };
}

export const room = (s: Stop): Room | undefined => s.rooms.find((r) => r.id === s.roomId) ?? s.rooms[0];
export const opener = (s: Stop): Opener | undefined => s.openers.find((o) => o.id === s.openerId) ?? s.openers[0];

/** Every night of a stop, as ISO dates: a two-night stand on 2027-05-07 plays 2027-05-07 and 2027-05-08. */
export const showNights = (s: Pick<Stop, "date" | "nights">): string[] => Array.from({ length: Math.max(1, s.nights ?? 1) }, (_, i) => addDays(s.date, i));

/** The stops either side of this one on the run, for the routing line a buyer looks for. */
function neighbours(plan: Plan, s: Stop): { prev?: Stop; next?: Stop } {
  const i = plan.stops.findIndex((x) => x.marketId === s.marketId && x.date === s.date);
  return i < 0 ? {} : { prev: plan.stops[i - 1], next: plan.stops[i + 1] };
}

/** "in from Knoxville (Sunday, May 9), out to Santa Fe (Friday, May 14)"; the first and last dates say so. */
export function routingWords(plan: Plan, s: Stop): string {
  const { prev, next } = neighbours(plan, s);
  const inn = prev ? `in from ${prev.city} (${longDate(showNights(prev).at(-1)!)})` : "the opening night of the run";
  const out = next ? `out to ${next.city} (${longDate(next.date)})` : "the last night of the run";
  return `${inn}, ${out}`;
}

/** What a room's size against the crowd lets the pitch say: "fits" only at 85–130% for one night. */
function sizeEvidence(r: Room, draw: number | undefined, nights: number): string {
  if (!r.capacity || !draw) return "";
  const cap = r.capacity.value;
  const f = fit(r, draw);
  if (nights > 1) {
    const all = cap * nights;
    return all >= draw
      ? ` One night is small for the usual crowd of about ${draw}; ${nights === 2 ? "two" : nights} nights hold ${all}, which covers it, so ask for both nights and don't call the room a fit for one.`
      : ` One night is small for the usual crowd of about ${draw}; ${nights === 2 ? "two" : nights} nights hold ${all}, still short of it, so ask for both nights, say plainly that they hold ${all} of about ${draw}, and don't call the room a fit.`;
  }
  if (f === "too small") return ` That is small for the usual crowd of about ${draw}: ask whether a second night or a larger room is possible, and don't call the room a fit.`;
  if (f === "too big") return ` That is large for the usual crowd of about ${draw}: ask about a reduced configuration, and don't call the room a fit.`;
  if (snugFit(cap, draw)) return ` That fits the usual crowd of about ${draw}.`;
  return cap < draw ? ` That holds ${cap} of the usual crowd of about ${draw} in one night: say so plainly, and don't call the room a fit.` : ` That is more than the usual crowd of about ${draw}: say it holds ${cap} against a usual crowd of about ${draw}, and don't call the room a fit.`;
}

/** The genres both acts are filed under among the tastes their audiences share (nothing off-genre in a pitch). */
export const billGenres = (plan: Plan, o: Opener) => sharedGenres(o.shared, plan.artist.genreKeys ?? plan.artist.genres, o.genres);

export function evidenceLines(plan: Plan, s: Stop, draw?: number): string[] {
  const r = room(s);
  const o = opener(s);
  const top = topAge(plan.audience.age);
  const lines = [
    `Artist: ${plan.artist.name}${plan.artist.genres.length ? ` (${plan.artist.genres.slice(0, 3).join(", ")})` : ""}`,
    (s.nights ?? 1) > 1 ? `Dates asked for: ${showNights(s).length === 2 ? "two" : showNights(s).length} nights, ${showNights(s).map((d) => `${longDate(d)} (${d})`).join(" and ")}` : `Date asked for: ${longDate(s.date)} (${s.date})`,
    `Hold asked for: a 1st hold on ${(s.nights ?? 1) > 1 ? "both dates" : "the date"}, or a 2nd hold if it is taken. Write the date with its year, ${s.date.slice(0, 4)}.`,
    `Routing: ${routingWords(plan, s)}.`,
    `City: ${s.label}. Of the ${plan.cities.length} cities where Qloo found ${plan.artist.name} fans in this region, ${s.city} ranks ${s.score.rank} for fan affinity.`,
    `Qloo fan-affinity score for ${s.city}: ${pct(s.score.affinity)} out of 100${s.score.popularity !== undefined ? `; popularity percentile ${pct(s.score.popularity)}` : ""} (scaled within this one map, so several cities can score 100: cite the rank, not this score).`,
  ];
  if (r) {
    lines.push(`Room: ${r.name}${r.address ? `, ${r.address}` : ""}.`);
    if (r.affinity !== undefined) lines.push(`Qloo affinity between ${plan.artist.name} fans and ${r.name}: ${pct(r.affinity)} out of 100.`);
    if (r.capacity) lines.push(`${r.name} capacity: ${r.capacity.value} (from ${r.capacity.source}).${sizeEvidence(r, draw, s.nights ?? 1)}`);
    else if (draw) lines.push(`${r.name}'s capacity isn't confirmed; the usual crowd is about ${draw}. Ask the room what it holds.`);
  }
  // "Sits in" only when Qloo files the room under the fans' own neighbourhood (geo/local.ts readLocal), not by distance.
  const read = stopLocal(s);
  if (read) lines.push(localEvidence(read, s.city, plan.artist.name));
  if (o) {
    const both = billGenres(plan, o);
    lines.push(`Support act for the whole run (travelling with the tour): ${o.name}${o.affinity !== undefined ? `. Qloo ranks ${o.name} ${pct(o.affinity)} out of 100 for ${plan.artist.name}'s audience (a match score: write "ranked ${pct(o.affinity)} for ${plan.artist.name}'s audience", never "shares an affinity")` : ""}${both.length ? `; both acts are filed under ${both.slice(0, 2).join(" and ")}` : ""}.`);
  }
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

/** Hyphenated words that really do have a one-letter part. */
const ONE_LETTER_OK = /^(e-mail|x-ray|t-shirts?|a-list|b-side|k-pop|j-pop|j-rock|u-turn|g-funk|r-rated|e-commerce|e-ticket|p-funk|d-beat)$/i;
const STOP_WORDS = new Set(["the", "a", "an", "of", "and", "to", "in", "on", "for", "at", "with", "is", "it", "this", "that", "be", "as", "by", "or"]);

/**
 * What reads as broken in model-written text, by rule: a run of three or more words repeated within a few words
 * ("#1 of 409 cities with a 100 fan-a cities with a 100 affinity score"), a word cut off at a hyphen ("fan-a"), the
 * same word twice in a row, doubled punctuation, a placeholder. Returns what was found; empty when the text is clean.
 * Each line is read on its own, so a subject and a body that name the same date don't count as a repeat.
 */
export function garbled(text: string): string[] {
  const lines = unstrike(text).split("\n");
  if (lines.length > 1) return [...new Set(lines.flatMap((l) => garbled(l)))];
  const t = lines[0]!;
  const found: string[] = [];
  const toks = t.toLowerCase().replace(/[^\p{L}\p{N}#'’\s-]/gu, " ").split(/\s+/).filter(Boolean);
  for (let n = 4; n >= 3; n--) {
    for (let i = 0; i + n <= toks.length; i++) {
      const gram = toks.slice(i, i + n);
      if (gram.every((w) => STOP_WORDS.has(w))) continue;
      const key = gram.join(" ");
      // The same words again with at most three words between: a sentence that restarted mid-way. (A date or a
      // room named twice in one email is normal, so farther repeats don't count.)
      for (let j = i + n; j <= Math.min(toks.length - n, i + n + 3); j++) {
        if (toks.slice(j, j + n).join(" ") === key) {
          if (!found.some((f) => f.includes(key))) found.push(`repeated "${key}"`);
          break;
        }
      }
    }
    if (found.length) break;
  }
  for (const m of t.matchAll(/\b[\p{L}]{2,}-[\p{Ll}]\b(?!-)/gu)) if (!ONE_LETTER_OK.test(m[0])) found.push(`broken word "${m[0]}"`);
  // Lower case only: "Duran Duran" and "Talk Talk" are names.
  for (const m of t.matchAll(/(?<![\p{L}])(\p{Ll}{2,})\s+\1(?![\p{L}])/gu)) if (!/^(that|had|is|very|so|no)$/.test(m[1]!)) found.push(`doubled "${m[0]}"`);
  if (/[,;:]\s*[,;:]|(?<!\.)\.\.(?!\.)|\s[,.;:](?=\s|$)/.test(t)) found.push("broken punctuation");
  if (/\[[A-Z][^\]]{0,30}\]|\{\{|\}\}|<[a-z]+>/.test(t)) found.push("a placeholder");
  return found;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a pitch claims more about the neighbourhood than the stop's street level supports (geo/local.ts
 * readLocal): "sits in" or "in the heart of" the fans' area when Qloo doesn't file the room there, the room "in"
 * the named area, or the old placeholder "one neighbourhood". The stored pitches wrote "sits in it" by distance.
 */
export function falseLocalClaim(text: string, read: LocalRead | undefined): boolean {
  const t = unstrike(text);
  if (/\bone neighbou?rhood\b/i.test(t)) return true;
  if (!read?.room || read.room.sitsIn) return false;
  if (/\bsits\s+(right\s+)?(in|inside|within)\b|\bin the (heart|middle|center|centre) of (their|the fans'?|that|this) (area|neighbou?rhood)\b|\bright where (the|these|her|his|their) fans (live|are)\b/i.test(t)) return true;
  return Boolean(read.area && new RegExp(`${escapeRe(read.room.name)}[^.]{0,40}\\b(is|lies|sits|located)\\s+(right\\s+)?in\\s+(the\\s+heart\\s+of\\s+)?${escapeRe(read.area)}\\b`, "i").test(t));
}

/** The street level a stop's evidence reads from, or undefined when it has none. */
export const stopLocal = (s: Stop): LocalRead | undefined => {
  const r = room(s);
  return s.local?.hot && r && Array.isArray(s.local.tiles) && s.local.tiles.length ? readLocal(s.local, r, [...s.rooms, ...(s.posters ?? []), ...s.after]) : undefined;
};

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
  return `${s.city} is ${artist}'s #${s.score.rank} city on Qloo${r.capacity ? `, and ${r.name} holds ${r.capacity.value.toLocaleString("en-US")}${s.nights === 2 ? " a night over two nights" : ""}` : r.affinity !== undefined ? `, and ${r.name} matches these fans at ${Math.round(r.affinity * 100)}` : `, and ${r.name} is a room these fans go to`}.`;
}

const RULE_WHY = /^.+ is .+'s #\d+ city on Qloo, and .+ (holds [~\d,]+( a night over two nights)?|matches these fans at [~\d]+|is a room these fans go to)\.$/;

/**
 * A stop's "why", checked. By default every stop with a room gets the rule's sentence, rebuilt from the stop as it
 * stands, so the voice is one voice on every tour (the model's lines on older tours read "Leipzig ranks #12
 * heatmap and …"). With `keepModel`, the model's sentence is kept when it is clean (no broken fragments) and not a
 * rule's; its figures are checked as written.
 */
export function checkWhy(plan: Plan, s: Stop, draw?: number, opts: { keepModel?: boolean } = {}): string | undefined {
  if (!s.why) return s.why;
  const r = room(s);
  const isRule = RULE_WHY.test(unstrike(s.why)) && Boolean(r && unstrike(s.why).includes(r.name));
  const text = r && (!opts.keepModel || isRule || garbled(s.why).length) ? ruleWhy(plan.artist.name, s, r) : s.why;
  return checkNumbers(text, whyEvidence(plan, s, draw)).text;
}

/** A pitch signed: the signature on the line under "Thanks," (added when the pitch has no sign-off); unchanged
 *  without one. */
export function signed(body: string, sign?: string): string {
  const name = sign?.trim();
  if (!name) return body;
  const text = body.trimEnd();
  if (text.endsWith(name)) return text;
  return /(^|\n)thanks,?$/i.test(text) ? `${text}\n${name}` : `${text}\n\nThanks,\n${name}`;
}

/** The room and the crowd in a pitch's words: "fits" only at 85–130% for one night, "covers" only when the nights hold it. */
function sizeAsk(r: Room, draw: number | undefined, nights: number): string {
  if (!r.capacity || !draw) return draw ? `We usually draw about ${n0(draw)}; could you confirm what the room holds?` : "";
  const cap = n0(r.capacity.value);
  const crowd = n0(draw);
  if (nights > 1) {
    const all = r.capacity.value * nights;
    return all >= draw ? `The room holds ${cap} and we usually draw about ${crowd}, so we're asking for both nights (${n0(all)} across the two).` : `The room holds ${cap} and we usually draw about ${crowd}; both nights together hold ${n0(all)} of that, so we're asking for both.`;
  }
  if (snugFit(r.capacity.value, draw)) return `The room's ${cap} fits our usual crowd of about ${crowd}.`;
  if (r.capacity.value < draw * 0.6) return `The room holds ${cap} against our usual crowd of about ${crowd}: would a second night or a larger room be possible?`;
  if (r.capacity.value > draw * 2.5) return `The room holds ${cap} against our usual crowd of about ${crowd}: could we talk about a reduced configuration?`;
  return r.capacity.value < draw ? `The room holds ${cap} of our usual crowd of about ${crowd}.` : `The room holds ${cap} against our usual crowd of about ${crowd}.`;
}

/**
 * A plain pitch from the evidence alone, for when the model is off, out of budget, or wrote something broken: the
 * date with its year and the hold asked for, the routing in and out, the room against the crowd, one plain line
 * of Qloo evidence, the support act, and an optional signature.
 */
export function templatePitch(plan: Plan, s: Stop, opts: { draw?: number; sign?: string } = {}): { subject: string; body: string } {
  const r = room(s);
  const o = opener(s);
  const nights = s.nights ?? 1;
  const days = showNights(s);
  const when = nights > 1 ? `${longDate(days[0]!)} and ${fullDate(days.at(-1)!)}` : fullDate(s.date);
  const both = o ? billGenres(plan, o) : [];
  const size = r ? sizeAsk(r, opts.draw, nights) : "";
  const body = [
    `Hi${r ? ` ${r.name} team` : ""},`,
    "",
    `Could we place a 1st hold for ${plan.artist.name} on ${when}${r ? ` at ${r.name}` : ""}? If ${nights > 1 ? "those dates are" : "the date is"} taken, a 2nd hold works while we confirm the routing.`,
    "",
    `Routing: ${routingWords(plan, s)}.`,
    ...(size ? [size] : []),
    `Why ${s.city}: Qloo ranks it #${s.score.rank} of ${plan.cities.length} cities in the region for ${plan.artist.name} fans.`,
    ...(o ? [`${o.name} supports on every date${both.length ? `; both acts are filed under ${both.slice(0, 2).join(" and ").toLowerCase()}` : ""}.`] : []),
    "",
    "Could you let me know about availability and your offer terms?",
    "",
    "Thanks,",
    ...(opts.sign?.trim() ? [opts.sign.trim()] : []),
  ].join("\n");
  return { subject: `Hold request: ${plan.artist.name}, ${s.city}, ${when}`, body };
}
