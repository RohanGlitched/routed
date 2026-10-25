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

/** Social posts and forums say what someone heard, not what the room holds. */
export const NOT_A_SOURCE = /^(https?:\/\/)?([a-z0-9-]+\.)*(facebook|twitter|x|instagram|reddit|tiktok|threads|pinterest|linkedin|youtube|quora|medium)\.com\b/i;

/**
 * Meeting, wedding and venue-hire pages give the room set for dinners and conferences, not a concert: Crystal
 * Ballroom's "Theater Capacity 800 Banquet Capacity 400" (it holds about 1,500 standing), Thalia Hall's "160
 * seated (rounds)", the Lyric's cvent "Total meeting space". Their sites and paths, and any number whose sentence
 * reads like one, don't count.
 */
const EVENT_SITE = /^(https?:\/\/)?([a-z0-9-]+\.)*(cvent|eventective|weddingwire|theknot|wedding-spot|bridebook|zola|peerspace|tagvenue|hirespace|splacer|thevendry|venuereport|eventup|meetingsnet|successfulmeetings|partyslate|giggster)\.(com|co|co\.uk|net)\b/i;
const EVENT_PATH = /[/.-](meetings?|weddings?|private-events?|privateevents|banquets?|event-spaces?|venue-hire|venue-finder|corporate-events?|rentals?|hire)([/.?#-]|$)/i;
const EVENT_WORDS = /\b(banquet|reception|classroom|boardroom|wedding|meeting|conference|cocktail[- ]style|u-shape|rounds|dinner|sq\.? ?ft|square feet|guest rooms)\b/i;

/** Whether a page is a meeting, wedding or venue-hire listing. */
export const eventSource = (url: string) => EVENT_SITE.test(url) || EVENT_PATH.test(url.replace(/^https?:\/\/[^/]+/, ""));

/** Room-type words: "Broadway Theatre" is another venue than "The Broadway" because of one. */
const ROOM_TYPE = /^(theatre|theater|hall|arena|ballroom|center|centre|club|room|auditorium|coliseum|amphitheatre|amphitheater|pavilion|stadium|opera|lounge|bar|complex|music|house|cafe|stage)$/;

/**
 * Whether a venue page's address is another venue's: a "/venue/" slug that lacks this room's distinctive words
 * (dice.fm/venue/kremwerk-complex for the Timbre Room), or that adds a room-type word this name doesn't have
 * (todaytix …/venues/broadway-theatre for The Broadway, a Brooklyn club).
 */
export function otherVenueUrl(venue: string, url: string): boolean {
  // Everything after "/venue/": an id segment can come first (livenation …/venue/KovZp…/the-fillmore-philadelphia-events).
  const m = url.replace(/[?#].*$/, "").match(/\/(?:venues?|locations?|places?|lieux?|spielstaetten?)\/([a-z0-9%/_-]+)/i);
  if (!m) return false;
  let path = m[1]!;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep it as written */
  }
  const slug = words(path);
  const mine = new Set(words(venue));
  const distinct = [...mine].filter((w) => !GENERIC.has(w));
  if (distinct.length && !distinct.some((w) => slug.includes(w))) return true;
  return slug.some((w) => ROOM_TYPE.test(w) && !mine.has(w));
}

/**
 * Whether the name next to a number is a longer venue's ("Broadway Theatre 1761 capacity" for The Broadway): every
 * time the name appears in the text before the number, the next word is a room type this name doesn't have.
 */
function longerName(venue: string, before: string): boolean {
  const mine = words(venue);
  const last = mine.at(-1);
  if (!last) return false;
  const text = words(before);
  const at: number[] = [];
  text.forEach((w, i) => w === last && at.push(i));
  if (!at.length) return false;
  return at.every((i) => {
    const next = text[i + 1];
    return Boolean(next && ROOM_TYPE.test(next) && !mine.includes(next));
  });
}

/**
 * A complex named as two rooms ("North Charleston Coliseum & Performing Arts Center"): the number belongs to the
 * main room, the first one. When the text before it names the second room and not the first one's own type word,
 * it is the second room's ("North Charleston Performing Arts Center Theater 2,300", where the coliseum holds
 * about 13,000).
 */
function subRoom(venue: string, before: string): boolean {
  const parts = venue.split(/\s+(?:&|and)\s+/i);
  if (parts.length < 2) return false;
  const main = words(parts[0]!);
  const second = ` ${words(parts.slice(1).join(" ")).join(" ")} `;
  const mainType = main.filter((w) => !second.includes(` ${w} `)).at(-1);
  if (!mainType) return false;
  // The complex's own full name says nothing about which room; the nearer of the two names to the number does.
  const text = ` ${words(before).join(" ")} `.split(` ${words(venue).join(" ")} `).join(" · ");
  const lastSecond = text.lastIndexOf(second);
  return lastSecond >= 0 && lastSecond > text.lastIndexOf(` ${mainType} `);
}

/**
 * Capacities checked by hand for rooms the readers get wrong, each with its source. One wins over Wikidata and
 * the web for that room in that city.
 */
const OVERRIDES: { venue: string; city: string; value: number; source: string; quote: string }[] = [
  // The concert room, not the meetings sheet ("Theater Capacity 800 Banquet Capacity 400").
  { venue: "McMenamins Crystal Ballroom", city: "Portland, OR", value: 1500, source: "https://en.wikipedia.org/wiki/Crystal_Ballroom_(Portland,_Oregon)", quote: "In concert configuration the ballroom holds up to 1,500 standing persons or 850 seated (Wikipedia, checked by hand Oct 25)." },
  { venue: "Crystal Ballroom", city: "Portland, OR", value: 1500, source: "https://en.wikipedia.org/wiki/Crystal_Ballroom_(Portland,_Oregon)", quote: "In concert configuration the ballroom holds up to 1,500 standing persons or 850 seated (Wikipedia, checked by hand Oct 25)." },
  // Standing for a show, not "160 seated (rounds)" from the weddings page; listings range 800 to 1,100.
  { venue: "Thalia Hall", city: "Chicago, IL", value: 800, source: "https://thrillzing.com/music-venues/thalia-hall-chicago/", quote: "Thalia Hall's main hall holds about 800 standing; venue listings agree (240 seated for a dinner), checked by hand Oct 25." },
  // The coliseum, not the Performing Arts Center theatre (2,300) on the same campus.
  { venue: "North Charleston Coliseum & Performing Arts Center", city: "Charleston, SC", value: 13000, source: "https://en.wikipedia.org/wiki/North_Charleston_Coliseum", quote: "North Charleston Coliseum: capacity 13,000 (13,295 center-stage, 8,805–12,645 end-stage), Wikipedia, checked by hand Oct 25." },
  { venue: "North Charleston Coliseum", city: "Charleston, SC", value: 13000, source: "https://en.wikipedia.org/wiki/North_Charleston_Coliseum", quote: "North Charleston Coliseum: capacity 13,000 (13,295 center-stage, 8,805–12,645 end-stage), Wikipedia, checked by hand Oct 25." },
];

const foldKey = (s: string) => words(s).join(" ");

/** A hand-checked capacity for this room in this city (the label, "Portland, OR": Portland, Maine is another), or null. */
export function capacityOverride(venue: string, city: string): { value: number; source: string; quote: string } | null {
  const v = foldKey(venue);
  const c = foldKey(city);
  const o = OVERRIDES.find((x) => foldKey(x.venue) === v && (c === foldKey(x.city) || c.endsWith(` ${foldKey(x.city)}`)));
  return o ? { value: o.value, source: o.source, quote: o.quote } : null;
}

/**
 * Whether a stored capacity still passes today's source rules for this room (so an answer read before a rule
 * existed is asked again): not a social post or a planned building, not a meeting or wedding page, not another
 * venue's page, and its quote not a banquet line, a longer venue's name or a sub-room's.
 */
export function sourceOk(venue: string, c: { source: string; quote: string }): boolean {
  if (NOT_A_SOURCE.test(c.source) || /planned|proposed|new-venue|will-open/i.test(c.source)) return false;
  if (c.source.includes("wikidata.org")) return true;
  if (eventSource(c.source) || otherVenueUrl(venue, c.source)) return false;
  if (EVENT_WORDS.test(c.quote)) return false;
  const at = c.quote.search(/\d{2,}/);
  const before = at > 0 ? c.quote.slice(0, at) : c.quote;
  return !longerName(venue, before) && !subRoom(venue, before);
}

/**
 * The capacity most sources agree on; on a tie, the larger (the main room, not a side stage). A page must name the
 * venue (its distinctive words) for its numbers to count, and must not be a meeting or wedding page or another
 * venue's page; a number must not sit in a banquet line, next to a longer venue's name, or next to a sub-room's.
 */
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
    if (eventSource(p.url) || otherVenueUrl(venue, p.url)) continue;
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
      // A banquet or meeting line, a longer venue's name ("Broadway Theatre"), a sub-room ("…Performing Arts
      // Center Theater 2,300"): not this room's concert capacity.
      const lead = h.piece.slice(Math.max(0, (h.at ?? 0) - 120), h.at ?? 0);
      const around = h.piece.slice(Math.max(0, (h.at ?? 0) - 80), (h.at ?? 0) + 60);
      if (EVENT_WORDS.test(around) || longerName(venue, lead) || subRoom(venue, lead)) continue;
      const cur = tally.get(h.value);
      if (cur) cur.n++;
      else tally.set(h.value, { n: 1, source: p.url, quote: h.quote });
    }
  }
  const best = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[0] - a[0])[0];
  return best ? { value: best[0], source: best[1].source, quote: best[1].quote } : null;
}
