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
// "Dante's" is "dantes", as a web address writes it.
const words = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ").split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * Whether a Wikidata item is this room and not a part of it or a namesake. An item that is "part of" something else
 * is a smaller room inside it (Nordstrom Recital Hall, 536, is part of Benaroya Hall). Otherwise the two names'
 * distinctive words must agree: the same words ("Lensic Theater" is the Lensic Performing Arts Center), or one
 * name's words all in the other's with at most one word more and never a short word alone. Sharing one word is a
 * namesake: Bush Hall is not Shepherd's Bush Empire (2,000), EartH is not the Hackney Empire (1,275). A room's
 * aliases in parentheses count as its names ("EartH (Evolutionary Arts Hackney)").
 */
export function sameVenue(venue: string, label: string, description = ""): boolean {
  if (/\bpart of\b|\bwithin\b|\binside\b|\bsecond stage\b|\bstudio theat/i.test(description)) return false;
  const inner = [...venue.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]!);
  const names = [venue, venue.replace(/\s*\([^)]*\)/g, ""), ...inner].filter((x) => x.trim());
  const theirs = [...new Set(words(label).filter((w) => !GENERIC.has(w)))];
  return names.some((name) => {
    const ours = [...new Set(words(name).filter((w) => !GENERIC.has(w)))];
    if (!ours.length || !theirs.length) return words(name).join(" ") === words(label).join(" ");
    const [short, long] = ours.length <= theirs.length ? [ours, theirs] : [theirs, ours];
    if (!short.every((w) => long.includes(w))) return false;
    if (long.length === short.length) return true;
    return long.length - short.length <= 1 && (short.length >= 2 || short[0]!.length >= 5);
  });
}

/** The item a stored Wikidata answer quotes ("Label: description; maximum capacity …"). */
export function wikidataLabel(quote: string): { label: string; description: string } {
  const [label, ...rest] = (quote.split("; maximum capacity")[0] ?? "").split(": ");
  return { label: label ?? "", description: rest.join(": ") };
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
 * Meeting, wedding and venue-hire listings (cvent, eventective, a venue's own private-events page). Their numbers
 * are the venue's own and often right (the Tennessee Theatre's "Seating capacity 1,645", the Great American Music
 * Hall's "650 Capacity"), but they are the second tier: read only when no other page gives this room a number.
 * What they get wrong is the configuration, which the label next to the number says (CONFIG_LABEL).
 */
const EVENT_SITE = /^(https?:\/\/)?([a-z0-9-]+\.)*(cvent|eventective|weddingwire|theknot|wedding-spot|bridebook|zola|peerspace|tagvenue|hirespace|splacer|thevendry|venuereport|eventup|meetingsnet|successfulmeetings|partyslate|giggster)\.(com|co|co\.uk|net)\b/i;
const EVENT_PATH = /[/.-](meetings?|weddings?|wedding-venue[a-z-]*|private-events?|privateevents|banquets?|event-spaces?|venue-hire|venue-finder|corporate-events?|rentals?|hire)([/.?#-]|$)/i;

/** Whether a page is a meeting, wedding or venue-hire listing (the second tier). */
export const eventSource = (url: string) => EVENT_SITE.test(url) || EVENT_PATH.test(url.replace(/^https?:\/\/[^/]+/, ""));

/**
 * A number labelled as a dinner or meeting layout, not a show: "Theater Capacity 800 Banquet Capacity 400" (the
 * Crystal Ballroom holds about 1,500 standing), "160 seated (rounds)" (Thalia Hall), "Sitting Capacity: 155". Only
 * the label right next to the number counts: "a standing room capacity of 1,200 and over 10,000 sq ft" is a show
 * number, and so is "3,000+ Sq Ft Up to 500 Capacity".
 */
const CONFIG_BEFORE = /\b(banquet|reception|classroom|boardroom|cocktail|u-shape|dinner|seated dinner|sitting|theat(?:er|re)[- ]style|theat(?:er|re) capacity)\b[^\d]{0,24}$/i;
const CONFIG_AFTER = /^[^\d]{0,12}\b(seated \(rounds\)|rounds|banquet|reception|classroom|boardroom|cocktail|for dinner|dinner|seated dinner)\b/i;
export function configNumber(text: string, at: number, len: number): boolean {
  const before = text.slice(Math.max(0, at - 36), at).split(/[|•#\n]|\s-\s/).pop() ?? "";
  const after = text.slice(at + len, at + len + 24).split(/[|•#\n]/)[0] ?? "";
  return CONFIG_BEFORE.test(before) || CONFIG_AFTER.test(after);
}

/** Room-type words: "Hawthorne Theatre Lounge" is a room inside the Hawthorne Theatre because of one. */
const ROOM_TYPE = /^(theatre|theater|hall|arena|ballroom|center|centre|club|room|auditorium|coliseum|amphitheatre|amphitheater|pavilion|stadium|lounge|studio)$/;
const nameWords = (venue: string) => words(venue).filter((w, i) => !(i === 0 && w === "the"));

/**
 * Venues that share a name with a bigger, better-documented one, so a page about the other one names this one too:
 * every page or quote matching `not` is the other venue's. Checked by hand.
 */
const NAMESAKES: { venue: string; not: RegExp }[] = [
  // The Broadway, 1272 Broadway, Brooklyn (a Bushwick club), is not Manhattan's Broadway Theatre (1,761 seats).
  { venue: "The Broadway", not: /broadway[\s-]+theat(re|er)/i },
];
const namesake = (venue: string, text: string) => NAMESAKES.some((n) => words(n.venue).join(" ") === words(venue).join(" ") && n.not.test(text));

/**
 * Whether text names a room inside this one: every time this room's full name appears, a room-type word it doesn't
 * have follows ("Hawthorne Theatre Lounge"). Only for a name that has a type of its own: "Orpheum" on a page as
 * "Orpheum Theatre" is the Orpheum, and "Brooklyn Bowl Nashville Music Venue Review" is Brooklyn Bowl.
 */
function extended(venue: string, text: string[]): boolean {
  const mine = nameWords(venue);
  if (!mine.length || !mine.some((w) => ROOM_TYPE.test(w))) return false;
  const at: number[] = [];
  for (let i = 0; i + mine.length <= text.length; i++) if (mine.every((w, k) => text[i + k] === w)) at.push(i + mine.length);
  return at.length > 0 && at.every((i) => Boolean(text[i] && ROOM_TYPE.test(text[i]!) && !mine.includes(text[i]!)));
}

/**
 * Whether a venue page's address is another venue's: the path after "/venue/" lacks this room's distinctive words
 * (dice.fm/venue/kremwerk-complex for the Timbre Room) when the path names any venue at all (an id alone, as on
 * vividseats …/venue/14384, can't say), names a room inside this one, or is a known namesake's.
 */
export function otherVenueUrl(venue: string, url: string): boolean {
  let path = url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep it as written */
  }
  if (namesake(venue, path)) return true;
  // Everything after "/venue/": an id segment can come first (livenation …/venue/KovZp…/the-fillmore-philadelphia-events).
  const m = path.match(/\/(?:venues?|locations?|places?|lieux?|spielstaetten?)\/([^?#]+)/i);
  if (!m) return false;
  const slug = words(m[1]!).filter((w) => /[a-z]{3,}/.test(w) && !/\d/.test(w));
  if (!slug.length) return false;
  const all = words(path);
  const distinct = [...new Set(words(venue))].filter((w) => !GENERIC.has(w));
  if (distinct.length && !distinct.some((w) => all.includes(w))) return true;
  return extended(venue, slug);
}

/**
 * A complex named as two rooms ("North Charleston Coliseum & Performing Arts Center"): the number belongs to the
 * main room, the first one. When the text before it names the second room after the first one's own type word,
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
 * Whether the number belongs to another venue named in the same clause: "The Mammoth Events Center has a capacity
 * of 5,100 and The Fillmore Auditorium has a seating…" (5,100 was stored for the Fillmore). The clause before the
 * number has another venue as its subject (capitalised words ending in a room-type word, then "has", "holds",
 * "seats"…) sharing none of this room's distinctive words. A neighbourhood in brackets ("(Van Ness - Civic
 * Center) 600 Capacity") or a room's own hall ("Great Hall (2nd floor) – 251 capacity") isn't a subject.
 */
function otherSubject(venue: string, before: string): boolean {
  const clause = before.split(/[.;!?\n]|,\s|\s(?:and|while|whereas)\s/).pop() ?? "";
  const distinct = words(venue).filter((w) => !GENERIC.has(w));
  if (!distinct.length) return false;
  for (const m of clause.matchAll(/\b((?:[A-Z][\w'’&.-]*\s+){0,4}(?:Theat(?:re|er)|Hall|Arena|Ballroom|Cent(?:er|re)|Club|Room|Auditorium|Coliseum|Amphithea(?:tre|ter)|Pavilion|Stadium|Lounge))\s+(?:has|have|holds|seats|can (?:hold|seat|accommodate)|accommodates|offers|boasts|is)\b/g)) {
    const named = words(m[1]!);
    if (named.filter((w) => !GENERIC.has(w)).length && !distinct.some((w) => named.includes(w))) return true;
  }
  return false;
}

/**
 * Capacities checked by hand, each with its source: rooms the readers get wrong, and well-known rooms Wikidata has
 * no capacity for (P1083), so they don't hang on a web search being up. One wins over Wikidata and the web for
 * that room in that city.
 */
const OVERRIDES: { venue: string[]; city: string; value: number; source: string; quote: string }[] = [
  // The concert room, not the meetings sheet ("Theater Capacity 800 Banquet Capacity 400").
  { venue: ["McMenamins Crystal Ballroom", "Crystal Ballroom"], city: "Portland, OR", value: 1500, source: "https://en.wikipedia.org/wiki/Crystal_Ballroom_(Portland,_Oregon)", quote: "In concert configuration the ballroom holds up to 1,500 standing persons or 850 seated (Wikipedia, checked by hand Oct 25)." },
  // Standing for a show, not "160 seated (rounds)" from the weddings page; listings range 800 to 1,100.
  { venue: ["Thalia Hall"], city: "Chicago, IL", value: 800, source: "https://thrillzing.com/music-venues/thalia-hall-chicago/", quote: "Thalia Hall's main hall holds about 800 standing; venue listings agree (240 seated for a dinner), checked by hand Oct 25." },
  // The coliseum, not the Performing Arts Center theatre (2,300) on the same campus.
  { venue: ["North Charleston Coliseum & Performing Arts Center", "North Charleston Coliseum"], city: "Charleston, SC", value: 13000, source: "https://en.wikipedia.org/wiki/North_Charleston_Coliseum", quote: "North Charleston Coliseum: capacity 13,000 (13,295 center-stage, 8,805–12,645 end-stage), Wikipedia, checked by hand Oct 25." },
  // The Oct 15 reader stored 5,100, the Mammoth Events Center's number from a page listing both.
  { venue: ["Fillmore Auditorium", "The Fillmore Auditorium"], city: "Denver, CO", value: 3900, source: "https://en.wikipedia.org/wiki/Fillmore_Auditorium_(Denver)", quote: "Fillmore Auditorium (Denver): capacity 3,900 (Wikipedia infobox, checked by hand Oct 25)." },
  { venue: ["Ogden Theatre"], city: "Denver, CO", value: 1600, source: "https://en.wikipedia.org/wiki/Ogden_Theatre", quote: "Built in 1917, it has a maximum capacity of 1,600 for concerts (Wikipedia, checked by hand Oct 25)." },
  { venue: ["Eccles Theater", "George S. and Dolores Doré Eccles Theater"], city: "Salt Lake City, UT", value: 2468, source: "https://en.wikipedia.org/wiki/Eccles_Theater", quote: "George S. and Dolores Doré Eccles Theater: capacity 2,468 (Wikipedia infobox, citing the Salt Lake Tribune; checked by hand Oct 25)." },
  { venue: ["Abravanel Hall", "Maurice Abravanel Hall"], city: "Salt Lake City, UT", value: 2768, source: "https://en.wikipedia.org/wiki/Abravanel_Hall", quote: "Maurice Abravanel Hall: capacity 2,768 (Wikipedia infobox, citing the hall's own one-sheet; checked by hand Oct 25)." },
  { venue: ["Capitol Theatre", "Janet Quinney Lawson Capitol Theatre"], city: "Salt Lake City, UT", value: 1876, source: "https://en.wikipedia.org/wiki/Capitol_Theatre_(Salt_Lake_City)", quote: "Janet Quinney Lawson Capitol Theatre: capacity 1,876 (Wikipedia infobox, checked by hand Oct 25)." },
  { venue: ["Austin City Limits Live (ACL Live & 3TEN ACL Live)", "ACL Live at the Moody Theater", "ACL Live", "Moody Theater"], city: "Austin, TX", value: 2750, source: "https://en.wikipedia.org/wiki/Moody_Theater", quote: "ACL Live at the Moody Theater: capacity 2,750 (Wikipedia infobox; the venue's sponsorship page agrees; checked by hand Oct 25)." },
  // Listings range 600 to 750 (750 is the private-events figure); 650 is the concert number most of them give.
  { venue: ["Neumos"], city: "Seattle, WA", value: 650, source: "https://seattlemag.com/music/best-live-music-venues-seattle/", quote: "Neumos: capacity 650 (Seattle Magazine venue listing; ReverbNation lists 700; checked by hand Oct 25)." },
  { venue: ["El Corazón", "El Corazon"], city: "Seattle, WA", value: 807, source: "https://songkick.com/concerts/40301737-origin-at-el-corazon", quote: "El Corazon, 109 Eastlake Ave E: capacity 807 (Songkick venue listing, checked by hand Oct 25)." },
  { venue: ["Jones Hall for the Performing Arts", "Jones Hall"], city: "Houston, TX", value: 2912, source: "https://en.wikipedia.org/wiki/Jones_Hall", quote: "Jones Hall: capacity 2,912 (Wikipedia infobox; about 2,300 with the balcony closed), checked by hand Oct 30" },
  // Oct 30: the booked rooms on the poster wall and the flagship's other rooms, checked by hand against Wikipedia, the
  // venue, its operator or the trade press, replacing ticket-resale and event-hire listings (Showbox SoDo's 1,800 had been
  // read for The Showbox; the Gaiety's 2,000 was its 1871 figure; Madison Theater's 17,556 was another building's).
  { venue: ["Brooklyn Bowl Nashville"], city: "Nashville, TN", value: 1200, source: "https://news.pollstar.com/2019/12/17/brooklyn-bowl-nashville-to-bring-old-coney-island-funhouse-carnival-vibe-to-music-city/", quote: "its 1,200-capacity, 50,000-square-foot space (checked by hand Oct 30)" },
  { venue: ["The Orange Peel","Orange Peel"], city: "Asheville, NC", value: 1050, source: "https://en.wikipedia.org/wiki/The_Orange_Peel", quote: "It has a capacity of 1,050 people. (checked by hand Oct 30)" },
  { venue: ["Bogart's","Bogarts"], city: "Cincinnati, OH", value: 1500, source: "https://en.wikipedia.org/wiki/Bogart%27s", quote: "further expanded to 1,500 seats in 1993 (checked by hand Oct 30)" },
  { venue: ["Minglewood Hall"], city: "Memphis, TN", value: 1900, source: "https://shorefire.com/releases/entry/minglewood-hall-to-reopen-this-spring", quote: "In addition to its 1900-capacity main hall, a smaller, 400-capacity lounge hosts performances (checked by hand Oct 30)" },
  { venue: ["The Showbox","Showbox","Showbox at the Market"], city: "Seattle, WA", value: 1130, source: "https://aegsev.com/the-showbox", quote: "The venue can accommodate up to 1,130 guests in a standing-room configuration. (checked by hand Oct 30)" },
  { venue: ["The Castro Theatre","Castro Theatre"], city: "San Francisco, CA", value: 1400, source: "https://en.wikipedia.org/wiki/Castro_Theatre", quote: "The theater has a capacity of 1,400 for concerts, or 1,150 for movies. (checked by hand Oct 30)" },
  { venue: ["The Bellwether","Bellwether"], city: "Los Angeles, CA", value: 1500, source: "https://thebellwetherla.com/", quote: "a multifaceted 1500-capacity music venue and nightlife destination (checked by hand Oct 30)" },
  { venue: ["The Vic Theatre","Vic Theatre"], city: "Chicago, IL", value: 1400, source: "https://en.wikipedia.org/wiki/The_Vic_Theatre", quote: "can easily accommodate 1,400 people or with a seated capacity of 1,000 (checked by hand Oct 30)" },
  { venue: ["Brooklyn Steel"], city: "New York, NY", value: 1800, source: "https://en.wikipedia.org/wiki/Brooklyn_Steel", quote: "Capacity 1,800 (infobox) (checked by hand Oct 30)" },
  { venue: ["The Gaiety Theatre","Gaiety Theatre"], city: "Dublin, Ireland", value: 1145, source: "https://en.wikipedia.org/wiki/Gaiety_Theatre,_Dublin", quote: "1,145 (on three levels) (checked by hand Oct 30)" },
  { venue: ["Leisureland"], city: "Galway, Ireland", value: 1000, source: "https://galwaymusiccentre.ie/venues", quote: "Maximum Capacity: 1,000 (checked by hand Oct 30)" },
  { venue: ["O2 Academy Bristol"], city: "Bristol, UK", value: 1600, source: "https://en.wikipedia.org/wiki/O2_Academy_Bristol", quote: "1,600 (Academy 1) (checked by hand Oct 30)" },
  { venue: ["O2 Forum Kentish Town","Kentish Town Forum","The Forum"], city: "London, UK", value: 2300, source: "https://en.wikipedia.org/wiki/Kentish_Town_Forum", quote: "increasing the capacity to 2,300 (checked by hand Oct 30)" },
  { venue: ["Bass Concert Hall"], city: "Austin, TX", value: 2900, source: "https://en.wikipedia.org/wiki/Bass_Concert_Hall", quote: "The hall seats 2,900 (checked by hand Oct 30)" },
  { venue: ["The Orpheum Theatre","Orpheum Theatre"], city: "Los Angeles, CA", value: 1976, source: "https://laorpheum.com/private-events", quote: "The Orpheum Theatre has a total seated capacity of 1,976. (checked by hand Oct 30)" },
  { venue: ["Dickies Arena","Ariat Arena"], city: "Fort Worth, TX", value: 14000, source: "https://en.wikipedia.org/wiki/Dickies_Arena", quote: "Concerts: 14,000 (checked by hand Oct 30)" },
  { venue: ["Germania Insurance Amphitheater","Germania Amphitheater","Austin360 Amphitheater"], city: "Austin, TX", value: 14000, source: "https://en.wikipedia.org/wiki/Germania_Insurance_Amphitheater", quote: "The venue opened in November 2012 with a capacity of 14,000. (checked by hand Oct 30)" },
  { venue: ["Danforth Music Hall"], city: "Toronto, ON", value: 1427, source: "https://en.wikipedia.org/wiki/Danforth_Music_Hall", quote: "1,427 (general admission) and 1,145 (reserved seating) (checked by hand Oct 30)" },
  { venue: ["Bronson Centre","Bronson Centre Music Theatre"], city: "Ottawa, ON", value: 900, source: "https://www.bronsoncentre.ca/", quote: "around 900-plus capacity (checked by hand Oct 30)" },
  { venue: ["The Fillmore Philadelphia","Fillmore Philadelphia"], city: "Philadelphia, PA", value: 2500, source: "https://www.visitphilly.com/things-to-do/attractions/the-fillmore-philadelphia/", quote: "a 2,500 capacity main room (checked by hand Oct 30)" },
  { venue: ["Vogue Theatre","The Vogue Theatre"], city: "Vancouver, BC", value: 1280, source: "https://en.wikipedia.org/wiki/Vogue_Theatre_(Vancouver)", quote: "Capacity 1,280 (infobox); 'The Vogue Theatre has 1,161 seats' (checked by hand Oct 30)" },
  { venue: ["Franklin Music Hall","Electric Factory"], city: "Philadelphia, PA", value: 2700, source: "https://aeggp.com/venues/franklin-music-hall", quote: "Capacity 2,700 (checked by hand Oct 30)" },
  { venue: ["Terminal 5"], city: "New York, NY", value: 2800, source: "https://www.aegsev.com/terminal-5", quote: "Standing Concert Capacity: 2800 (checked by hand Oct 30)" },
  { venue: ["The Riviera Theatre","Riviera Theatre"], city: "Chicago, IL", value: 2500, source: "https://en.wikipedia.org/wiki/Riviera_Theatre", quote: "Capacity 2,500 (infobox) (checked by hand Oct 30)" },
  { venue: ["The Wiltern","Wiltern"], city: "Los Angeles, CA", value: 2300, source: "https://en.wikipedia.org/wiki/Wiltern_Theatre", quote: "originally seated 2,344 (infobox seating capacity 1,850) (checked by hand Oct 30)" },
  { venue: ["Black Cat","The Black Cat"], city: "Washington, DC", value: 800, source: "https://en.wikipedia.org/wiki/Black_Cat_(Washington,_D.C.,_nightclub)", quote: "Mainstage\\\" concert venue is on the second floor in a 7000 square-foot space with a capacity of 800. (checked by hand Oct 30)" },
  { venue: ["Theatre of The Living Arts","Theatre of the Living Arts","TLA"], city: "Philadelphia, PA", value: 800, source: "https://en.wikipedia.org/wiki/Theatre_of_Living_Arts", quote: "Capacity 800 (infobox) (checked by hand Oct 30)" },
  { venue: ["Tipitina's","Tipitinas"], city: "New Orleans, LA", value: 800, source: "https://en.wikipedia.org/wiki/Tipitina%27s", quote: "Capacity 800 (infobox) (checked by hand Oct 30)" },
  { venue: ["Historic Scoot Inn","Scoot Inn"], city: "Austin, TX", value: 1000, source: "https://news.pollstar.com/2017/08/01/c3-acquires-austins-scoot-inn/", quote: "Its 1,000- capacity backyard stage comes complete with its own sound and lighting systems (checked by hand Oct 30)" },
  { venue: ["Madison Theater"], city: "Cincinnati, OH", value: 1200, source: "https://news.pollstar.com/?p=490100", quote: "A 1,200-capacity venue in Covington, Ky., suddenly has a lot going for it (checked by hand Oct 30)" },
  { venue: ["Exit/In"], city: "Nashville, TN", value: 500, source: "https://en.wikipedia.org/wiki/Exit/In", quote: "expanded in the early 1980s to accommodate 500 patrons (checked by hand Oct 30)" },
  { venue: ["Ryman Auditorium"], city: "Nashville, TN", value: 2362, source: "https://en.wikipedia.org/wiki/Ryman_Auditorium", quote: "Capacity: 2,362 (1994-present) (checked by hand Oct 30)" },
  { venue: ["Levitt Pavilion Denver"], city: "Denver, CO", value: 7500, source: "https://visitdenver.com/blog/post/levitt-pavilion-denver/", quote: "The lawn seating ... can hold up to 7,500. (checked by hand Oct 30)" },
];

const foldKey = (s: string) => words(s).join(" ");

/** A hand-checked capacity for this room in this city (the label, "Portland, OR": Portland, Maine is another), or null. */
export function capacityOverride(venue: string, city: string): { value: number; source: string; quote: string } | null {
  const v = foldKey(venue);
  const c = foldKey(city);
  const o = OVERRIDES.find((x) => x.venue.some((n) => foldKey(n) === v) && (c === foldKey(x.city) || c.endsWith(` ${foldKey(x.city)}`)));
  return o ? { value: o.value, source: o.source, quote: o.quote } : null;
}

/** Where a value sits in a quote, as written ("1,600", "1.600", "1600"). */
function findValue(quote: string, value: number): { at: number; len: number } | null {
  const s = String(value);
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, "[,.\\u00a0 ]?");
  const m = new RegExp(`(?<![\\d,.])${grouped}(?![\\d])`).exec(quote);
  return m ? { at: m.index, len: m[0].length } : null;
}

/**
 * Whether a stored capacity still passes today's source rules for this room (so an answer read before a rule
 * existed is asked again): not a social post or a planned building, not another venue's page, and the number in
 * its quote not a dinner layout, not another venue's or a sub-room's. A meeting or venue-hire listing passes when
 * its number does: it was the best page the reader had.
 */
export function sourceOk(venue: string, c: { value?: number; source: string; quote: string }): boolean {
  if (NOT_A_SOURCE.test(c.source) || /planned|proposed|new-venue|will-open/i.test(c.source)) return false;
  // A Wikidata answer is only as good as its item: the quoted label must be this room (the shared index once held
  // Shepherd's Bush Empire's 2,000 for Bush Hall; first writer wins, so a bad entry is refused here and re-measured).
  if (c.source.includes("wikidata.org")) {
    const { label, description } = wikidataLabel(c.quote);
    return sameVenue(venue, label, description);
  }
  if (otherVenueUrl(venue, c.source) || namesake(venue, c.quote)) return false;
  const first = /\d{1,3}(?:[,.]\d{3})+|\d{2,}/.exec(c.quote);
  const v = (c.value !== undefined ? findValue(c.quote, c.value) : null) ?? (first ? { at: first.index, len: first[0].length } : null);
  if (!v) return true;
  const before = c.quote.slice(0, v.at);
  if (configNumber(c.quote, v.at, v.len)) return false;
  return !extended(venue, words(before)) && !subRoom(venue, before) && !otherSubject(venue, before);
}

/**
 * The capacity most sources agree on; on a tie, the larger (the main room, not a side stage). A page must name the
 * venue (its distinctive words) for its numbers to count, and must not be another venue's page; a number must not
 * be a dinner layout, a room inside this one, or another venue's in the same clause. Meeting and venue-hire
 * listings are read only when no other page gave a number.
 */
export function pickCapacity(venue: string, pages: { url: string; text: string }[], city?: string, trace?: (url: string, why: string) => void): { value: number; source: string; quote: string } | null {
  const skip = (url: string, why: string) => (trace?.(url, why), true);
  const fold = (s: string) => ` ${s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
  const distinct = fold(venue)
    .trim()
    .split(" ")
    .filter((w) => w.length > 2 && !["the", "and", "club", "hall", "theatre", "theater", "room", "bar", "music", "venue"].includes(w));
  // Whole words only ("The Ark" is not in "Docklands"); a name with no distinctive word ("9:30 Club") must appear whole.
  const names = (text: string) => (distinct.length ? distinct.every((w) => text.includes(` ${w} `)) : text.includes(fold(venue)));
  const town = city ? fold(city.split(",")[0]!) : null;
  const tiers = [new Map<number, { n: number; source: string; quote: string }>(), new Map<number, { n: number; source: string; quote: string }>()];
  for (const p of pages) {
    if ((NOT_A_SOURCE.test(p.url) || /planned|proposed|new-venue|will-open/i.test(p.url)) && skip(p.url, "not a source")) continue;
    if (otherVenueUrl(venue, p.url) && skip(p.url, "another venue's page")) continue;
    const tier = eventSource(p.url) ? 1 : 0;
    const page = fold(p.text);
    if (!names(page) && skip(p.url, "page doesn't name the room")) continue;
    // Komedia Bath is not Komedia Bristol: the page or its address must name the city.
    if (town && !page.includes(town) && !fold(p.url).includes(town) && skip(p.url, "page doesn't name the city")) continue;
    // Search snippets join pieces of a page with "[...]": each piece stands alone, so a number is never read
    // next to a name from another part of the page.
    const pieces = p.text.split("[...]");
    for (const h of pieces.flatMap((piece) => capacitiesIn(piece).map((x) => ({ ...x, piece })))) {
      // On a page listing many venues the number must sit next to this one's name (within 250 characters).
      const near = fold(h.piece.slice(Math.max(0, (h.at ?? 0) - 250), (h.at ?? 0) + 120));
      if (!names(near) && skip(p.url, `${h.value}: name not next to it`)) continue;
      const v = findValue(h.piece.slice(h.at ?? 0), h.value);
      const numAt = (h.at ?? 0) + (v?.at ?? 0);
      const lead = h.piece.slice(Math.max(0, numAt - 120), numAt);
      if (configNumber(h.piece, numAt, v?.len ?? String(h.value).length) && skip(p.url, `${h.value}: a dinner or meeting layout`)) continue;
      if (namesake(venue, lead) && skip(p.url, `${h.value}: a namesake venue's`)) continue;
      if (extended(venue, words(lead)) && skip(p.url, `${h.value}: a room inside this one`)) continue;
      if (subRoom(venue, lead) && skip(p.url, `${h.value}: a sub-room's number`)) continue;
      if (otherSubject(venue, lead) && skip(p.url, `${h.value}: another venue's number`)) continue;
      trace?.(p.url, `${h.value}: counted${tier ? " (listing page, second tier)" : ""}`);
      const tally = tiers[tier]!;
      const cur = tally.get(h.value);
      if (cur) cur.n++;
      else tally.set(h.value, { n: 1, source: p.url, quote: h.quote });
    }
  }
  const tally = tiers[0]!.size ? tiers[0]! : tiers[1]!;
  const best = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[0] - a[0])[0];
  return best ? { value: best[0], source: best[1].source, quote: best[1].quote } : null;
}
