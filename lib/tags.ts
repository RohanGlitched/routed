/**
 * Qloo's strings as the pages print them. Qloo's tag and genre names come in mixed shapes ("Alt- country",
 * "Indie - Folk", "Storyteller", "americana"); the tour book prints them one way, in lower case with proper
 * names and acronyms kept. Search results repeat a name as its own disambiguation ("Sierra Ferrell (Sierra
 * Ferrell)"); the aside is dropped when it says nothing new. Pure, so the rules are tested (test/tags.test.ts).
 */

/** Words that keep their capital (names of places and peoples a genre is named after) or their acronym. */
const KEEP: Record<string, string> = {
  american: "American",
  americana: "americana",
  british: "British",
  english: "English",
  irish: "Irish",
  scottish: "Scottish",
  welsh: "Welsh",
  canadian: "Canadian",
  mexican: "Mexican",
  latin: "Latin",
  african: "African",
  celtic: "Celtic",
  appalachian: "Appalachian",
  texas: "Texas",
  christian: "Christian",
  usa: "USA",
  uk: "UK",
  us: "US",
  diy: "DIY",
  edm: "EDM",
  idm: "IDM",
  "r&b": "R&B",
  "lgbtq+": "LGBTQ+",
  k: "K",
  j: "J",
};

/**
 * One tag or genre as the page prints it: "Alt- country" → "alt-country", "Indie - Folk" → "indie folk",
 * "Storyteller" → "storyteller", "American Folk" → "American folk", "R&B" stays "R&B".
 */
export function displayTag(raw: string): string {
  const s = raw
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    // "Alt- country", "Alt -country": a hyphen joined to one word is a compound.
    .replace(/(\w)-\s+(?=\w)/g, "$1-")
    .replace(/(\w)\s+-(?=\w)/g, "$1-")
    // "Indie - Folk": a spaced dash between two genres is a list, read as one name.
    .replace(/\s+[-–—]\s+/g, " ");
  return s.replace(/[\p{L}][\p{L}&+']*/gu, (w) => {
    const k = w.toLowerCase();
    if (k in KEEP) return KEEP[k]!;
    // An acronym Qloo already writes in capitals ("EDM", "UK") stays one.
    if (w.length >= 2 && w === w.toUpperCase() && /\p{Lu}/u.test(w)) return w;
    return k;
  });
}

/** Tags once each, in the order given, after display folding ("Alt- country" and "alt country" are one). */
export function displayTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = displayTag(r);
    const k = fold(t);
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** For comparing names: accents, case and punctuation aside. */
export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The aside to print after a name, or nothing when it only repeats the name ("Sierra (Sierra)"). */
export function aside(name: string, extra?: string): string | undefined {
  const e = extra?.trim();
  if (!e || fold(e) === fold(name)) return undefined;
  return e;
}

/**
 * Drops a bracketed aside that only repeats the name before it, in a stored line of text:
 * "Sierra Ferrell (Sierra Ferrell); also found Sierra (Sierra)" → "Sierra Ferrell; also found Sierra".
 * Other asides stay ("Nashville (#2)", "Bogart's (holds 1,200)").
 */
export function dropEchoes(text: string): string {
  return text.replace(/ \(([^()]+)\)/g, (m, inner: string, at: number) => {
    // The words since the last separator, so "also found Sierra" still echoes "Sierra".
    const before = fold(text.slice(0, at).split(/[;:,]/).at(-1) ?? "");
    const want = fold(inner);
    if (!want) return m;
    return before === want || before.endsWith(` ${want}`) ? "" : m;
  });
}
