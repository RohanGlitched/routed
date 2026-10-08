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

export type CapacityHit = { value: number; quote: string };

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
      if (/smaller|second stage|side room|annex|lounge|downstairs|upstairs|patio|rooftop|\bmin(?:imum)?\b\.?\s*$/.test(before)) continue;
      const start = Math.max(0, (m.index ?? 0) - 60);
      const end = Math.min(text.length, (m.index ?? 0) + m[0].length + 40);
      hits.push({ value, quote: text.slice(start, end).replace(/\s+/g, " ").trim() });
    }
  }
  return hits;
}

/**
 * The capacity most sources agree on; on a tie, the larger (the main room, not a side stage). A page must name the
 * venue (its distinctive words) for its numbers to count.
 */
export function pickCapacity(venue: string, pages: { url: string; text: string }[]): { value: number; source: string; quote: string } | null {
  const words = venue
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "club", "hall", "theatre", "theater", "room", "bar", "music", "venue"].includes(w));
  // A name with no distinctive word ("9:30 Club") must appear whole, or any page would do.
  const whole = venue.toLowerCase().trim();
  const tally = new Map<number, { n: number; source: string; quote: string }>();
  for (const p of pages) {
    const lower = p.text.toLowerCase();
    if (words.length ? !words.every((w) => lower.includes(w)) : !lower.includes(whole)) continue;
    for (const h of capacitiesIn(p.text)) {
      const cur = tally.get(h.value);
      if (cur) cur.n++;
      else tally.set(h.value, { n: 1, source: p.url, quote: h.quote });
    }
  }
  const best = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[0] - a[0])[0];
  return best ? { value: best[0], source: best[1].source, quote: best[1].quote } : null;
}
