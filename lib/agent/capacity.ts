/**
 * Reads a room's capacity out of web text, by rule: a number tied to the word capacity ("capacity of 1,100",
 * "1,100-capacity", "holds 1,100", "capacity: 1100"). The quote it came from is kept so the page can show it.
 * Numbers under 50 or over 25,000 are not a club or theatre capacity and are ignored.
 */
/** A number as pages write it: 1,500 / 1.500 / 1 500 / 1500 / 100,000; never a bare digit run inside a bigger one. */
const N = String.raw`(\d{1,3}(?:[,.\u00a0 ]\d{3})+|\d{2,6})(?![\d,])`;
const PATTERNS = [
  new RegExp(String.raw`(?:capacity|kapazit[aä]t|capacit[eé]|aforo|capienza)(?:\s+of)?(?:\s+(?:about|around|approximately|roughly|up\s+to|nearly|over|just\s+over|is|was|von|de|di))*\s*[:=]?\s*${N}`, "gi"),
  new RegExp(String.raw`\b${N}[-\s](?:person|people|seat|seated)?[-\s]?capacity\b`, "gi"),
  new RegExp(String.raw`\b(?:holds|accommodates|fits|seats)\s+(?:about|around|approximately|up\s+to|nearly|over)?\s*${N}\s+(?:people|guests|fans|patrons|standing)`, "gi"),
];

export type CapacityHit = { value: number; quote: string; at?: number };

type Stored = { value: number; source: string; quote: string } | null;

const GENERIC = new Set(["the", "and", "club", "hall", "theatre", "theater", "room", "bar", "music", "venue", "center", "centre", "arts", "performing", "auditorium", "house", "ballroom", "arena", "amphitheater", "amphitheatre", "live", "concert", "stage", "at", "of"]);
const words = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * Whether a Wikidata item is this room and not a part of it or a namesake: the venue's distinctive words must be
 * in the item's label ("Lensic Theater" is the Lensic Performing Arts Center), and an item that is "part of"
 * something else is a smaller room inside it (Nordstrom Recital Hall, 536, is part of Benaroya Hall).
 */
export function sameVenue(venue: string, label: string, description = ""): boolean {
  if (/\bpart of\b|\bwithin\b|\binside\b|\bsecond stage\b|\bstudio theat/i.test(description)) return false;
  const distinct = words(venue).filter((w) => !GENERIC.has(w));
  const have = new Set(words(label));
  if (!distinct.length) return words(venue).every((w) => have.has(w));
  return distinct.some((w) => have.has(w)) && distinct.filter((w) => have.has(w)).length >= Math.min(2, distinct.length) - (distinct.length > 2 ? 1 : 0);
}

/**
 * Merges this instance's capacity answers into the shared index so a room has one number everywhere: what the
 * index already holds for a room wins (the first answer published), except that a found number replaces a
 * "not found".
 */
export function mergeCapacities(ours: Record<string, Stored>, theirs: Record<string, Stored>): Record<string, Stored> {
  const all: Record<string, Stored> = { ...ours };
  for (const [k, v] of Object.entries(theirs)) if (v || !all[k]) all[k] = v;
  return all;
}

export function capacitiesIn(text: string): CapacityHit[] {
  const hits: CapacityHit[] = [];
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const value = Number(m[1]!.replace(/[,.\u00a0 ]/g, ""));
      if (value < 50 || value > 120_000) continue;
      // "a smaller stage (capacity 250)", "Min capacity: 200": not the main room's number. Only the same sentence
      // counts, so "Upstairs: 200. Main room: 900" keeps the 900.
      const before = text.slice(Math.max(0, (m.index ?? 0) - 50), m.index ?? 0).toLowerCase().split(/[.;\n]/).pop() ?? "";
      if (/smaller|second stage|side room|annex|lounge|downstairs|upstairs|patio|rooftop|studio|recital|occasionally|\bmin(?:imum)?\b\.?\s*$/.test(before)) continue;
      // "It will seat 2,700, with a full capacity of 4,400": a building that doesn't exist yet isn't the room.
      const sentence = text.slice(Math.max(0, (m.index ?? 0) - 120), m.index ?? 0).toLowerCase().split(/[.;\n]/).pop() ?? "";
      if (/\b(will|would|proposed|planned|plans?|future|under construction|to be built|expansion)\b/.test(sentence)) continue;
      const start = Math.max(0, (m.index ?? 0) - 60);
      const end = Math.min(text.length, (m.index ?? 0) + m[0].length + 40);
      hits.push({ value, quote: text.slice(start, end).replace(/\s+/g, " ").trim(), at: m.index ?? 0 });
    }
  }
  return hits;
}

/**
 * The capacity most sources agree on; on a tie, the larger (the main room, not a side stage). A page must name the
 * venue (its distinctive words) for its numbers to count.
 */
/** Social posts and forums say what someone heard, not what the room holds. */
export const NOT_A_SOURCE = /^(https?:\/\/)?([a-z0-9-]+\.)*(facebook|twitter|x|instagram|reddit|tiktok|threads|pinterest|linkedin|youtube|quora|medium)\.com\b/i;

export function pickCapacity(venue: string, pages: { url: string; text: string }[], city?: string): { value: number; source: string; quote: string } | null {
  const fold = (s: string) => ` ${s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const distinct = fold(venue)
    .trim()
    .split(" ")
    .filter((w) => w.length > 2 && !["the", "and", "club", "hall", "theatre", "theater", "room", "bar", "music", "venue"].includes(w));
  // Whole words only ("The Ark" is not in "Docklands"); a name with no distinctive word ("9:30 Club") must appear whole.
  const names = (text: string) => (distinct.length ? distinct.every((w) => text.includes(` ${w} `)) : text.includes(fold(venue)));
  const town = city ? fold(city.split(",")[0]!) : null;
  const tally = new Map<number, { n: number; source: string; quote: string }>();
  for (const p of pages) {
    if (NOT_A_SOURCE.test(p.url) || /planned|proposed|new-venue|will-open/i.test(p.url)) continue;
    const page = fold(p.text);
    if (!names(page)) continue;
    // Komedia Bath is not Komedia Bristol: the page or its address must name the city.
    if (town && !page.includes(town) && !fold(p.url).includes(town)) continue;
    // Search snippets join pieces of a page with "[...]": each piece stands alone, so a number is never read
    // next to a name from another part of the page.
    const pieces = p.text.split("[...]");
    for (const h of pieces.flatMap((piece) => capacitiesIn(piece).map((x) => ({ ...x, piece })))) {
      // On a page listing many venues the number must sit next to this one's name (within 250 characters).
      const near = fold(h.piece.slice(Math.max(0, (h.at ?? 0) - 250), (h.at ?? 0) + 120));
      if (!names(near)) continue;
      const cur = tally.get(h.value);
      if (cur) cur.n++;
      else tally.set(h.value, { n: 1, source: p.url, quote: h.quote });
    }
  }
  const best = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[0] - a[0])[0];
  return best ? { value: best[0], source: best[1].source, quote: best[1].quote } : null;
}
