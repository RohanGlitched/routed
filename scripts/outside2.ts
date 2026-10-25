// Outside tests, round 2: tests the model can't win from memory. The protocol is data/outside2/PROTOCOL.md,
// committed with this file before any Qloo or model call for these tests ran.
//
// Usage (from routed/; the keys are read from .env.local by the loader below, never printed):
//   node --conditions=react-server --import tsx scripts/outside2.ts truth    # Wikipedia + Wikidata only: real venues, crowds, openers
//   node --conditions=react-server --import tsx scripts/outside2.ts sample   # post-cutoff tours (Wikipedia, plus one Qloo search per candidate)
//   node --conditions=react-server --import tsx scripts/outside2.ts run      # Qloo + model calls, tests in priority order, hard caps
//   node --conditions=react-server --import tsx scripts/outside2.ts score    # data/outside2/results.json and the tables
//
// Raw Qloo responses never leave .probe/outside2 (gitignored); the published files carry only derived names,
// ranks and hit counts.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RegionId } from "../lib/geo/markets.ts";
import type { Artist, CityScore, Opener, Room, TourRecord, Usage } from "../lib/types.ts";

/* ───────────────────────── env (only the keys these tests need) ───────────────────────── */

function loadEnv() {
  if (!existsSync(".env.local")) return;
  const want = new Set(["QLOO_API_KEY", "QLOO_BASE_URL", "NEBIUS_API_KEY", "NEBIUS_BASE_URL"]);
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m || !want.has(m[1]!) || process.env[m[1]!]) continue;
    process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

// Imported after the env is set: lib/qloo.ts and lib/nebius.ts read their base URLs when they load.
const { findMarket, marketById, marketId, marketLabel, nearestMarket, REGIONS, US_STATES, CA_ABBR } = await import("../lib/geo/markets.ts");
const { blendRanking, blendTwo, completeRanking, meanCI, populationRanking, rPrecision, beyondBiggest, signTest, avg } = await import("../lib/headtohead.ts");
const { clean, splitTop, infoboxArtist, marketsByRegion, showRows, regionOfCountry } = await import("../lib/wikitours.ts");
const { realMarkets, realTourFor } = await import("../lib/outside.ts");
const { search, recommend, wherePopular, toEntity } = await import("../lib/qloo.ts");
const { MODELS, structured } = await import("../lib/nebius.ts");
const { newUsage, withUsage } = await import("../lib/usage.ts");
const { HEAT_AREAS, scoreCities } = await import("../lib/agent/cities.ts");
const { lookUpRooms, lookUpOpeners } = await import("../lib/agent/tools.ts");
const { BIG_ROOM_DRAW, BIG_ROOM_TAGS, candidatesBySize, cityArea, genresOf, isRoom, ladderTier, nearCity, orchestraHallFor, pickArtist, roomLadder, venueTier } = await import("../lib/agent/rooms.ts");
const { wikidataRoomsNear } = await import("../lib/wikidata.ts");

/* ───────────────────────── fixed parameters (PROTOCOL.md) ───────────────────────── */

const DATA = "data/outside2";
const H2H = "data/head-to-head";
const CACHE = ".probe/outside2";
const H2H_CACHE = ".probe/h2h";
/** Real-tour cities tested per artist in the venue test, drawn by hash order. */
const CITIES_PER_ARTIST = 3;
/** A tour needs this many of its venues measured on Wikidata (P1083) for a crowd size. */
const MIN_MEASURED = 2;
const K = 3;
/** Qloo request caps per test; the three sum to 390, under the owner's 400, leaving room for retries. */
const QLOO_CAP = { venues: 235, support: 65, postcut: 90 } as const;
const QLOO_TOTAL_CAP = 400;
/** Token Factory list price for Nemotron 3 Ultra (dollars per token), as in scripts/head-to-head.ts; stop before $1.40. */
const PRICE = { in: 1e-6, out: 3e-6 };
const MODEL_STOP_USD = 1.4;
/** Post-cutoff: tours announced after this date (Nemotron 3 Ultra's public release, later than both cutoffs). */
const CUTOFF = "2026-06-04";
const POSTCUT_SIZE = 20;
const POSTCUT_MIN = 10;
const MIN_MARKETS = 8;
const SEED = 20261025;
const UA = "RoutedOutside2/1.0 (https://github.com/RohanGlitched/routed)";

/** The h2h bench artists and their Oct 15 benchmark tour ids (scripts/head-to-head.ts BENCH). */
const BENCH: Record<string, string> = {
  "Zach Bryan": "ycw8uxaih4", "Tyler Childers": "h9unk4ctck", Caamp: "bbtnq56vfv", Waxahatchee: "9tjig3f979", Khruangbin: "43wf8pvmzv",
  "Durand Jones & The Indications": "n25xq8c6j9", Ghost: "vfzwt8vpab", "Knocked Loose": "fzpz68yjqg", Turnstile: "h2puujjejv", Cuco: "79kyqre6nk",
  "MJ Lenderman": "2qhu4qsskk", Parcels: "d2ki8vdty2", "Jamie xx": "thvmp9vhbc", Alvvays: "nipn2k4cnd", "Arlo Parks": "gyr7wp8vpn", "Wet Leg": "cdnahzimdu",
  "Japanese Breakfast": "bgyrxqguyf", "Fontaines D.C.": "avqijwpkgy", JPEGMAFIA: "ecm4c8q9xe", Clairo: "kvda9edhz9",
};

/* ───────────────────────── small helpers ───────────────────────── */

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const slug = (s: string) => fold(s).replace(/ /g, "-");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const writeJson = (p: string, v: unknown) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 1) + "\n");
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function cached<T>(path: string, fn: () => Promise<T>): Promise<T> {
  if (existsSync(path)) return readJson<T>(path);
  const v = await fn();
  writeJson(path, v);
  return v;
}

async function getJson(u: string): Promise<any> {
  let last = "";
  for (let i = 0; i < 5; i++) {
    const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/json" } }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }) as Response);
    if (r.ok) return r.json();
    last = `${r.status}`;
    await sleep(1200 * (i + 1));
  }
  throw new Error(`fetch failed (${last}): ${u.slice(0, 120)}`);
}
const wiki = (params: Record<string, string>) => getJson(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`);
const wikidata = (params: Record<string, string>) => getJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ format: "json", ...params })}`);

/* ───────────────────────── usage and caps ───────────────────────── */

type Ledger = { qloo: Record<string, number>; modelCalls: number; tokensIn: number; tokensOut: number };
const LEDGER = `${CACHE}/usage.json`;
const ledger = (): Ledger => (existsSync(LEDGER) ? readJson<Ledger>(LEDGER) : { qloo: {}, modelCalls: 0, tokensIn: 0, tokensOut: 0 });
const qlooTotal = (l: Ledger) => Object.values(l.qloo).reduce((a, b) => a + b, 0);
const dollars = (l: Pick<Ledger, "tokensIn" | "tokensOut">) => l.tokensIn * PRICE.in + l.tokensOut * PRICE.out;

class CapReached extends Error {}

/** Runs one live step under a usage tally and adds what it spent to the ledger. Refuses a Qloo step that could pass a cap. */
async function spend<T>(test: keyof typeof QLOO_CAP | "sample", qlooNeed: number, modelNeed: { in: number; out: number } | null, fn: () => Promise<T>): Promise<T> {
  const l = ledger();
  const cap = test === "sample" ? QLOO_CAP.postcut : QLOO_CAP[test];
  const used = test === "sample" || test === "postcut" ? (l.qloo.sample ?? 0) + (l.qloo.postcut ?? 0) : (l.qloo[test] ?? 0);
  if (qlooNeed && (used + qlooNeed > cap || qlooTotal(l) + qlooNeed > QLOO_TOTAL_CAP)) throw new CapReached(`Qloo cap for ${test} (${used}/${cap}, total ${qlooTotal(l)}/${QLOO_TOTAL_CAP})`);
  if (modelNeed && dollars(l) + modelNeed.in * PRICE.in + modelNeed.out * PRICE.out > MODEL_STOP_USD) throw new CapReached(`model budget ($${dollars(l).toFixed(3)} spent)`);
  const u: Usage = newUsage();
  try {
    return await withUsage(u, fn);
  } finally {
    const now = ledger();
    now.qloo[test] = (now.qloo[test] ?? 0) + u.qloo;
    now.modelCalls += u.modelCalls;
    now.tokensIn += u.tokensIn;
    now.tokensOut += u.tokensOut;
    writeJson(LEDGER, now);
  }
}

/* ───────────────────────── reading tour tables (venue and opener columns too) ───────────────────────── */

type Cell = { raw: string; text: string; link?: string; rowspan: number; colspan: number };
function cell(raw: string): Cell {
  const parts = splitTop(raw, "|");
  let attrs = "", content = raw;
  if (parts.length > 1 && /^\s*(rowspan|colspan|style|scope|class|align|width|bgcolor|data-sort-value)\b[^[{]*$/i.test(parts[0]!)) {
    attrs = parts[0]!;
    content = parts.slice(1).join("|");
  } else if (/^\s*(rowspan|colspan)\s*=\s*"?\d+"?\s*\{\{/i.test(raw)) {
    attrs = raw.slice(0, raw.indexOf("{{"));
    content = raw.slice(raw.indexOf("{{"));
  }
  const rowspan = Number(/rowspan\s*=\s*"?(\d+)/i.exec(attrs)?.[1] ?? 1);
  const colspan = Number(/colspan\s*=\s*"?(\d+)/i.exec(attrs)?.[1] ?? 1);
  const link = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/.exec(content)?.[1]?.trim();
  return { raw: content, text: clean(content), link, rowspan, colspan };
}

const FESTIVALS = /festival|\bfest\b|fest\]|open air|lollapalooza|coachella|bonnaroo|glastonbury|primavera|roskilde|rock am ring|rock im park|hellfest|governors ball|austin city limits|outside lands|osheaga|pukkelpop|werchter|sziget|mad cool|lowlands|pinkpop|wacken|graspop|bumbershoot|firefly|boston calling|shaky knees|life is beautiful|electric forest|bottlerock|summerfest|stagecoach|when we were young|riot fest|aftershock|welcome to rockville|sonic temple|louder than life|corona capital|rock werchter|nos alive|bilbao bbk|benicassim|tw classic|best kept secret|way out west|flow festival|nova rock|isle of wight|tramlines|boardmasters|all points east|bst hyde park|trnsmt|electric picnic|creamfields|reading festival|la route du rock|rock en seine|les vieilles charrues|lollapalooza|montreux jazz|paléo|paleo|gurtenfestival|openair/i;

export type RowPlus = { date: string; city: string; country: string; venue: string; venueLink?: string; openers: Name[] };
/** A name as the page gives it: the shown text and, when linked, the article title. */
export type Name = { text: string; link?: string };

/** Links in a piece of wikitext, refs left out: [[Target|Text]] gives { text: Text, link: Target }. */
function linksIn(s: string): Name[] {
  const t = s.replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "").replace(/\{\{efn[\s\S]*?\}\}/gi, "");
  return [...t.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g)]
    .map((m) => ({ text: clean(m[2] ?? m[1]!), link: m[1]!.trim() }))
    .filter((n) => n.text && !/^(file|image|category):/i.test(n.link ?? ""));
}

const NOT_AN_ACT = /^(none|n\/?a|tba|tbc|tbd|—|–|-|special guests?|various|various artists|local support|unknown|\?)$/i;
/** The acts named in an opener cell or bullet: its links, else its plain text split on commas, semicolons and line breaks. */
function actsIn(raw: string): Name[] {
  const out: Name[] = [];
  for (const piece of raw.split(/<br\s*\/?>|\n/i)) {
    const links = linksIn(piece);
    if (links.length) out.push(...links);
    else for (const t of clean(piece).split(/[,;]/)) if (t.trim()) out.push({ text: t.trim() });
  }
  return out.filter((n) => n.text && !NOT_AN_ACT.test(n.text.trim()) && n.text.length < 80);
}

/** Every show row (lib/wikitours.ts showRows's rule, kept identical) with the venue's link and the opener column. */
export function rowsPlus(wikitext: string): RowPlus[] {
  const rows: RowPlus[] = [];
  const lines = wikitext.split("\n");
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const h = /^(=+)\s*(.*?)\s*=+\s*$/.exec(lines[i]!);
    if (h) {
      heading = h[2]!;
      continue;
    }
    if (!lines[i]!.trim().startsWith("{|")) continue;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !lines[j]!.trim().startsWith("|}"); j++) body.push(lines[j]!);
    i = j;
    if (/cancel/i.test(heading)) continue;
    const caption = body.find((l) => l.trim().startsWith("|+")) ?? "";
    if (/cancel/i.test(caption)) continue;
    rows.push(...tableRowsPlus(body));
  }
  return rows;
}

function tableRowsPlus(body: string[]): RowPlus[] {
  const groups: string[][] = [[]];
  for (const l of body) {
    const t = l.trim();
    if (t.startsWith("|+")) continue;
    if (t.startsWith("|-")) {
      groups.push([]);
      continue;
    }
    if (t.startsWith("|") || t.startsWith("!")) groups.at(-1)!.push(t);
    else if (groups.at(-1)!.length) groups.at(-1)![groups.at(-1)!.length - 1] += "\n" + t;
  }
  const rawCells = (g: string[]) => g.flatMap((l) => splitTop(l.slice(1), l.startsWith("!") ? "!!" : "||").flatMap((x) => (l.startsWith("!") ? splitTop(x, "||") : [x])));
  let header: string[] | null = null;
  const out: RowPlus[] = [];
  let carry: { cell: Cell; left: number }[] = [];
  for (const g of groups) {
    if (!g.length) continue;
    const cells = rawCells(g).map(cell);
    if (!header) {
      const names = cells.map((c) => c.text.toLowerCase());
      if (names.some((n) => n === "city" || n.startsWith("city"))) {
        header = names;
        carry = names.map(() => ({ cell: cell(""), left: 0 }));
      }
      continue;
    }
    if (cells.some((c) => c.text.toLowerCase() === "city") && cells.some((c) => c.text.toLowerCase() === "venue")) continue;
    const row: Cell[] = [];
    let k = 0;
    for (let col = 0; col < header.length; col++) {
      if (carry[col]!.left > 0) {
        row.push(carry[col]!.cell);
        carry[col]!.left--;
        continue;
      }
      const c = cells[k++];
      if (!c) {
        row.push(cell(""));
        continue;
      }
      for (let s = 0; s < c.colspan && col + s < header.length; s++) {
        row.push(c);
        if (c.rowspan > 1) carry[col + s] = { cell: c, left: c.rowspan - 1 };
      }
      col += c.colspan - 1;
    }
    const at = (name: string) => header!.findIndex((h) => h === name || h.startsWith(name));
    const iCity = at("city"), iCountry = at("country"), iVenue = at("venue"), iDate = at("date");
    const iOpen = header.findIndex((h) => /^(opening|support|special guest)/.test(h));
    const whole = row.map((c) => c.raw).join(" ");
    if (/cancel|postpon/i.test(whole)) continue;
    if (FESTIVALS.test(row[iVenue]?.raw ?? "") || FESTIVALS.test(row[iDate]?.raw ?? "")) continue;
    const city = row[iCity];
    if (!city || !city.text) continue;
    const v = row[iVenue];
    out.push({ date: row[iDate]?.text ?? "", city: city.link ?? city.text, country: row[iCountry]?.text ?? "", venue: v?.text ?? "", venueLink: v?.link, openers: iOpen >= 0 && row[iOpen] ? actsIn(row[iOpen]!.raw) : [] });
  }
  return out;
}

/** Openers from a section headed "Opening acts", "Supporting acts" or "Special guests": its bullet lines. */
export function sectionOpeners(wikitext: string): Name[] {
  const lines = wikitext.split("\n");
  const out: Name[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = /^(=+)\s*(.*?)\s*=+\s*$/.exec(lines[i]!);
    if (!h || !/opening act|support(ing)? act|special guest|^support$|^openers?$/i.test(h[2]!)) continue;
    const level = h[1]!.length;
    for (let j = i + 1; j < lines.length; j++) {
      const h2 = /^(=+)\s*(.*?)\s*=+\s*$/.exec(lines[j]!);
      if (h2 && h2[1]!.length <= level) break;
      const l = lines[j]!.trim();
      if (/^[*#]/.test(l)) out.push(...actsIn(l.replace(/^[*#:]+\s*/, "").replace(/\s*\(.*?\)\s*$/, "")));
    }
  }
  return out;
}

/* ───────────────────────── venue names and matching ───────────────────────── */

/** Words that don't tell two rooms apart (lib/agent/capacity.ts's list). */
const GENERIC = new Set(["the", "and", "club", "hall", "theatre", "theater", "room", "bar", "music", "venue", "center", "centre", "arts", "performing", "auditorium", "house", "ballroom", "arena", "amphitheater", "amphitheatre", "live", "concert", "stage", "at", "of"]);
const distinct = (s: string) => new Set(fold(s).split(" ").filter((w) => w.length > 1 && !GENERIC.has(w)));
const noParen = (s: string) => s.replace(/\s*\(.*?\)\s*$/, "").trim();

/**
 * Whether a listed room is one of the real venue's names: equal after folding, or one name's distinctive words a
 * subset of the other's, where the smaller set has at least two words or the larger has at most two ("The Forum"
 * is the Kia Forum; "The O2" is not O2 Academy Brixton).
 */
export function sameRoom(a: string, b: string): boolean {
  if (!fold(a) || !fold(b)) return false;
  if (fold(a) === fold(b)) return true;
  const x = distinct(a), y = distinct(b);
  const [s, l] = x.size <= y.size ? [x, y] : [y, x];
  if (!s.size) return false;
  if (![...s].every((w) => l.has(w))) return false;
  return s.size >= 2 || l.size <= 2;
}

/** The 1-based place of the first listed room that is one of the real venues, or null. */
export function rankOf(listed: string[], real: string[][]): number | null {
  for (let i = 0; i < listed.length; i++) if (real.some((names) => names.some((n) => sameRoom(n, listed[i]!)))) return i + 1;
  return null;
}

/* ───────────────────────── stage: truth (Wikipedia and Wikidata only) ───────────────────────── */

type Subject = { artist: string; set: "bench" | "held-out"; region: RegionId; truth: string[]; tour: string; source?: string; title?: string; revid?: number; qlooId?: string; benchId?: string };

function subjects(): Subject[] {
  const out: Subject[] = [];
  for (const [artist, id] of Object.entries(BENCH)) {
    const real = realTourFor(artist);
    if (!real) continue;
    const wp = real.sources.find((s) => /en\.wikipedia\.org/.test(s));
    const title = wp ? decodeURIComponent(new URL(wp).searchParams.get("title") ?? "").replace(/_/g, " ") : undefined;
    out.push({ artist, set: "bench", region: real.region, truth: [...realMarkets(real)], tour: real.tour ?? "", source: wp, title: title || undefined, benchId: id });
  }
  const held = readJson<{ taken: { artist: string; qlooId: string; title: string; revid: number; region: RegionId; markets: string[]; source: string }[] }>(`${H2H}/held-out.json`).taken;
  for (const h of held) out.push({ artist: h.artist, set: "held-out", region: h.region, truth: h.markets, tour: h.title, source: h.source, title: h.title, revid: h.revid, qlooId: h.qlooId });
  return out;
}

async function wikitextOf(s: Subject): Promise<{ text: string; revid: number } | null> {
  if (!s.title) return null;
  if (s.revid) {
    const p = `${H2H_CACHE}/wiki/${sha(s.title).slice(0, 16)}.json`;
    const j = existsSync(p) ? readJson<any>(p) : await cached(`${CACHE}/wiki/${s.revid}.json`, () => wiki({ action: "query", prop: "revisions", rvprop: "ids|content", rvslots: "main", revids: String(s.revid) }));
    const rev = j.query.pages[0]?.revisions?.[0];
    if (rev?.revid === s.revid) return { text: rev.slots.main.content, revid: rev.revid };
  }
  const j = await cached(`${CACHE}/wiki/t-${sha(s.title).slice(0, 16)}.json`, () => wiki({ action: "query", prop: "revisions", rvprop: "ids|content", rvslots: "main", titles: s.title!, redirects: "1" }));
  const rev = j.query.pages[0]?.revisions?.[0];
  return rev ? { text: rev.slots.main.content, revid: rev.revid } : null;
}

async function coordinates(names: string[]): Promise<Record<string, [number, number]>> {
  const out: Record<string, [number, number]> = {};
  for (let i = 0; i < names.length; i += 40) {
    const batch = names.slice(i, i + 40);
    const j = await cached(`${CACHE}/coords/${sha(batch.join("|")).slice(0, 16)}.json`, () => wiki({ action: "query", prop: "coordinates", redirects: "1", titles: batch.join("|") }));
    const back = new Map<string, string>();
    for (const n of batch) back.set(n, n);
    for (const x of j.query?.normalized ?? []) back.set(x.to, back.get(x.from) ?? x.from);
    for (const x of j.query?.redirects ?? []) back.set(x.to, back.get(x.from) ?? x.from);
    for (const p of j.query?.pages ?? []) {
      const c = p.coordinates?.[0];
      if (!c) continue;
      let name = p.title;
      while (back.has(name) && back.get(name) !== name) name = back.get(name)!;
      out[name] = [c.lat, c.lon];
    }
  }
  return out;
}

/** Wikipedia article titles to Wikidata ids (redirects followed). */
async function qidsOf(titles: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const j = await cached(`${CACHE}/pageprops/${sha(batch.join("|")).slice(0, 16)}.json`, () => wiki({ action: "query", prop: "pageprops", ppprop: "wikibase_item", redirects: "1", titles: batch.join("|") }));
    const back = new Map<string, string>();
    for (const n of batch) back.set(n, n);
    for (const x of j.query?.normalized ?? []) back.set(x.to, back.get(x.from) ?? x.from);
    for (const x of j.query?.redirects ?? []) back.set(x.to, back.get(x.from) ?? x.from);
    for (const p of j.query?.pages ?? []) {
      const q = p.pageprops?.wikibase_item;
      if (!q) continue;
      let name = p.title;
      while (back.has(name) && back.get(name) !== name) name = back.get(name)!;
      out[name] = q;
    }
  }
  return out;
}

/** Wikidata items' English label, aliases and maximum capacity (P1083). */
async function itemsOf(qids: string[]): Promise<Record<string, { label?: string; aliases: string[]; capacity?: number }>> {
  const out: Record<string, { label?: string; aliases: string[]; capacity?: number }> = {};
  for (let i = 0; i < qids.length; i += 40) {
    const batch = qids.slice(i, i + 40);
    const j = await cached(`${CACHE}/wikidata/${sha(batch.join("|")).slice(0, 16)}.json`, () => wikidata({ action: "wbgetentities", ids: batch.join("|"), props: "labels|aliases|claims", languages: "en" }));
    for (const [id, e] of Object.entries<any>(j.entities ?? {})) {
      const amount = e.claims?.P1083?.[0]?.mainsnak?.datavalue?.value?.amount;
      const cap = amount ? Math.round(Number(amount)) : undefined;
      out[id] = { label: e.labels?.en?.value, aliases: (e.aliases?.en ?? []).map((a: { value: string }) => a.value), capacity: cap && cap >= 50 && cap <= 120_000 ? cap : undefined };
    }
    await sleep(300);
  }
  return out;
}

type VenueCity = { marketId: string; city: string; venues: { names: string[]; qid?: string; capacity?: number }[] };
type VenueSubject = { artist: string; set: Subject["set"]; region: RegionId; tour: string; source: string; revid: number; qlooId?: string; benchId?: string; draw: number; measured: number; cities: VenueCity[]; marketsWithVenue: number };
type SupportSubject = { artist: string; set: Subject["set"]; region: RegionId; tour: string; source: string; qlooId?: string; benchId?: string; openers: { names: string[] }[]; from: "column" | "section"; cities: string[] };

async function truth() {
  const venueSet: VenueSubject[] = [];
  const supportSet: SupportSubject[] = [];
  const skipped: { artist: string; test: "venues" | "support"; reason: string }[] = [];
  for (const s of subjects()) {
    const w = await wikitextOf(s);
    if (!w) {
      skipped.push({ artist: s.artist, test: "venues", reason: "no Wikipedia tour article among the tour's sources (press listings only)" });
      skipped.push({ artist: s.artist, test: "support", reason: "no Wikipedia tour article among the tour's sources (press listings only)" });
      continue;
    }
    const source = `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(s.title!.replace(/ /g, "_"))}&oldid=${w.revid}`;
    const truthSet = new Set(s.truth);
    const rows = rowsPlus(w.text).filter((r) => regionOfCountry(r.country) === s.region);
    const unplaced = [...new Set(rows.filter((r) => !findMarket(r.city, s.region) && !findMarket(r.city.split(",")[0]!, s.region)).map((r) => r.city))];
    const at = await coordinates(unplaced);
    const marketOf = (r: RowPlus) => {
      const p = at[r.city];
      const m = findMarket(r.city, s.region) ?? findMarket(r.city.split(",")[0]!, s.region) ?? (p ? nearestMarket({ lat: p[0], lon: p[1] }, s.region, 60) : null);
      return m ? marketId(m) : null;
    };
    // Only the scored tour's markets count (for a bench artist, the leg in data/real-tours.json).
    const placed = rows.map((r) => ({ r, id: marketOf(r) })).filter((x): x is { r: RowPlus; id: string } => Boolean(x.id && truthSet.has(x.id)));

    // Venues.
    const links = [...new Set(placed.map((x) => x.r.venueLink).filter((x): x is string => Boolean(x)))];
    const qids = await qidsOf(links);
    const items = await itemsOf([...new Set(Object.values(qids))]);
    const byMarket = new Map<string, VenueCity>();
    const caps = new Map<string, number>();
    for (const { r, id } of placed) {
      if (!r.venue && !r.venueLink) continue;
      const qid = r.venueLink ? qids[r.venueLink] : undefined;
      const it = qid ? items[qid] : undefined;
      const names = [...new Set([r.venue, r.venueLink ? noParen(r.venueLink) : "", it?.label ? noParen(it.label) : "", ...(it?.aliases ?? [])].filter((n) => n && fold(n)))];
      if (!names.length) continue;
      const vc = byMarket.get(id) ?? { marketId: id, city: marketById(id)!.name, venues: [] };
      if (!vc.venues.some((v) => (qid && v.qid === qid) || v.names.some((n) => names.some((m) => fold(n) === fold(m))))) vc.venues.push({ names, qid, capacity: it?.capacity });
      byMarket.set(id, vc);
      if (qid && it?.capacity) caps.set(qid, it.capacity);
    }
    const capList = [...caps.values()].sort((a, b) => a - b);
    const draw = capList.length ? Math.round(capList[Math.floor((capList.length - 1) / 2)]! / 100) * 100 || capList[0]! : 0;
    const cities = [...byMarket.values()].sort((a, b) => (sha(`${s.artist}|${a.marketId}`) < sha(`${s.artist}|${b.marketId}`) ? -1 : 1));
    if (!cities.length) skipped.push({ artist: s.artist, test: "venues", reason: "the tour's date tables name no venue in the scored region" });
    else if (capList.length < MIN_MEASURED) skipped.push({ artist: s.artist, test: "venues", reason: `${capList.length} of the tour's venues have a Wikidata capacity (fewer than ${MIN_MEASURED}), so no crowd size` });
    else venueSet.push({ artist: s.artist, set: s.set, region: s.region, tour: s.tour, source, revid: w.revid, qlooId: s.qlooId, benchId: s.benchId, draw, measured: capList.length, marketsWithVenue: cities.length, cities: cities.slice(0, CITIES_PER_ARTIST) });

    // Openers: the opener column in the scored rows, else the "Opening acts" section.
    const me = fold(s.artist);
    const uniq = (xs: Name[]) => {
      const seen = new Map<string, { names: string[] }>();
      for (const n of xs) {
        const names = [...new Set([n.text, n.link ? noParen(n.link) : ""].filter((x) => x && fold(x)))];
        if (names.some((x) => fold(x) === me)) continue;
        const key = fold(names[0]!);
        if (!seen.has(key)) seen.set(key, { names });
      }
      return [...seen.values()];
    };
    const col = uniq(placed.flatMap((x) => x.r.openers));
    const sec = col.length ? [] : uniq(sectionOpeners(w.text));
    const openers = col.length ? col : sec;
    // Routed looks openers up per stop; the test asks in the tour's two biggest markets.
    const big = [...new Set(placed.map((x) => x.id))].sort((a, b) => marketById(b)!.pop - marketById(a)!.pop).slice(0, 2);
    if (!openers.length) skipped.push({ artist: s.artist, test: "support", reason: "no opener column in the scored rows and no opening-acts section" });
    else supportSet.push({ artist: s.artist, set: s.set, region: s.region, tour: s.tour, source, qlooId: s.qlooId, benchId: s.benchId, openers, from: col.length ? "column" : "section", cities: big });
    console.log(`${s.artist.padEnd(32)} venues: ${byMarket.size} markets, ${capList.length} measured, draw ${draw} | openers: ${openers.length} (${col.length ? "column" : sec.length ? "section" : "none"})`);
  }
  // The test order: artists by the SHA-256 of their name, so a cap stops at a point nobody picked.
  const order = <T extends { artist: string }>(xs: T[]) => [...xs].sort((a, b) => (sha(a.artist) < sha(b.artist) ? -1 : 1));
  writeJson(`${DATA}/venues-truth.json`, { rule: "data/outside2/PROTOCOL.md, test 1", citiesPerArtist: CITIES_PER_ARTIST, subjects: order(venueSet), skipped: skipped.filter((x) => x.test === "venues") });
  writeJson(`${DATA}/support-truth.json`, { rule: "data/outside2/PROTOCOL.md, test 2", subjects: order(supportSet), skipped: skipped.filter((x) => x.test === "support") });
  const tested = venueSet.reduce((n, v) => n + v.cities.length, 0);
  const pairs = new Set(venueSet.flatMap((v) => v.cities.map((c) => `${c.marketId}|${venueTier(v.draw).name}`)));
  const two = (d: number) => d >= BIG_ROOM_DRAW && !venueTier(d).tags.every((t) => BIG_ROOM_TAGS.includes(t));
  const est = venueSet.reduce((n, v) => n + v.cities.length * (two(v.draw) ? 2 : 1), 0) + [...pairs].reduce((n, p) => n + (/theatres, amphitheatres and arenas/.test(p) ? 2 : 1), 0);
  console.log(`venues: ${venueSet.length} artists, ${tested} cities, ${pairs.size} city-tier pairs, about ${est} Qloo calls | support: ${supportSet.length} artists, about ${supportSet.length * 2 + supportSet.filter((x) => !x.benchId).length} Qloo calls`);
}

/* ───────────────────────── stage: sample (post-cutoff tours) ───────────────────────── */

type PostCut = { artist: string; qlooId: string; title: string; revid: number; created: string; announced?: string; region: RegionId; markets: string[]; source: string };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Every date written in a piece of prose: "June 12, 2026", "12 June 2026", "June 2026" (as the 1st), {{Start date|2026|6|12}}. */
export function datesIn(s: string): string[] {
  const out: string[] = [];
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const mon = MONTHS.join("|");
  for (const m of s.matchAll(new RegExp(`\\b(${mon})\\s+(\\d{1,2}),?\\s+(\\d{4})`, "gi"))) out.push(iso(+m[3]!, MONTHS.indexOf(m[1]!.toLowerCase()) + 1, +m[2]!));
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(${mon}),?\\s+(\\d{4})`, "gi"))) out.push(iso(+m[3]!, MONTHS.indexOf(m[2]!.toLowerCase()) + 1, +m[1]!));
  for (const m of s.matchAll(new RegExp(`(?<!\\d\\s)\\b(${mon})\\s+(\\d{4})\\b`, "gi"))) out.push(iso(+m[2]!, MONTHS.indexOf(m[1]!.toLowerCase()) + 1, 1));
  for (const m of s.matchAll(/\{\{\s*start date[^|]*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/gi)) out.push(iso(+m[1]!, +m[2]!, +m[3]!));
  // A year on its own ("announced in 2025") counts as January 1 of that year.
  for (const m of s.matchAll(/\b(?:in|during|of|late|early|mid)[\s-]+(20\d{2})\b/gi)) out.push(iso(+m[1]!, 1, 1));
  return out;
}

/** The dates in the article's sentences that say "announce", refs, tables and infobox left out. */
export function announcementDates(wikitext: string): string[] {
  let t = wikitext.replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  t = t.replace(/^\{\|[\s\S]*?^\|\}/gm, "");
  const prose = t
    .split("\n")
    .filter((l) => !/^\s*[|!{}]/.test(l))
    .join("\n");
  return prose
    .split(/(?<=[.!?])\s+|\n/)
    .filter((x) => /announc/i.test(x))
    .flatMap(datesIn);
}

async function sample() {
  const catPath = `${DATA}/categories.json`;
  if (!existsSync(catPath)) {
    const titles = new Set<string>();
    for (const y of ["2026", "2027"]) {
      let cont: string | undefined;
      do {
        const j = await wiki({ action: "query", list: "categorymembers", cmtitle: `Category:${y} concert tours`, cmlimit: "500", cmtype: "page", ...(cont ? { cmcontinue: cont } : {}) });
        for (const m of j.query.categorymembers) titles.add(m.title);
        cont = j.continue?.cmcontinue;
      } while (cont);
    }
    writeJson(catPath, { fetched: new Date().toISOString(), categories: ["Category:2026 concert tours", "Category:2027 concert tours"], titles: [...titles].sort() });
  }
  const { titles } = readJson<{ titles: string[] }>(catPath);
  const order = [...titles].sort((a, b) => (sha(a) < sha(b) ? -1 : 1));
  const h2hArtists = new Set<string>(); // kept for the report only: post-cutoff tours by h2h artists are allowed
  for (const s of subjects()) h2hArtists.add(fold(s.artist));
  const taken: PostCut[] = [];
  const skipped: { title: string; reason: string }[] = [];
  const seen = new Set<string>();
  let walked = 0;
  for (const title of order) {
    if (taken.length >= POSTCUT_SIZE) break;
    walked++;
    const page = await cached(`${CACHE}/pc-wiki/${sha(title).slice(0, 16)}.json`, () => wiki({ action: "query", prop: "revisions", rvprop: "ids|content", rvslots: "main", titles: title }));
    const rev = page.query.pages[0]?.revisions?.[0];
    const text: string = rev?.slots?.main?.content ?? "";
    const artist = infoboxArtist(text);
    if (!artist) {
      skipped.push({ title, reason: "the infobox doesn't name exactly one artist" });
      continue;
    }
    if (seen.has(fold(artist))) {
      skipped.push({ title, reason: `${artist} already has a tour in the set` });
      continue;
    }
    const first = await cached(`${CACHE}/pc-first/${sha(title).slice(0, 16)}.json`, () => wiki({ action: "query", prop: "revisions", rvprop: "timestamp", rvdir: "newer", rvlimit: "1", titles: title }));
    const created: string = (first.query.pages[0]?.revisions?.[0]?.timestamp ?? "").slice(0, 10);
    if (!created || created <= CUTOFF) {
      skipped.push({ title, reason: `${artist}: the article was created ${created || "on an unknown date"}, not after ${CUTOFF}` });
      continue;
    }
    const ann = announcementDates(text).sort();
    if (ann.length && ann[0]! <= CUTOFF) {
      skipped.push({ title, reason: `${artist}: a sentence about the announcement gives ${ann[0]}, not after ${CUTOFF}` });
      continue;
    }
    const rows = showRows(text);
    const unplaced = [...new Set(rows.filter((r) => regionOfCountry(r.country) && !findMarket(r.city, regionOfCountry(r.country)) && !findMarket(r.city.split(",")[0]!, regionOfCountry(r.country))).map((r) => r.city))];
    const at = await coordinates(unplaced);
    const by = marketsByRegion(rows, at);
    const region = (["na", "uk", "eu"] as RegionId[]).sort((a, b) => by[b].length - by[a].length)[0]!;
    if (by[region].length < MIN_MARKETS) {
      skipped.push({ title, reason: `${artist}: ${by[region].length} touring markets in one region (fewer than ${MIN_MARKETS}; ${rows.length} show rows read)` });
      continue;
    }
    let found;
    try {
      found = await spend("sample", 1, null, () => cached(`${CACHE}/pc-search/${slug(artist)}.json`, async () => (await search(artist, "urn:entity:artist", 5)).entities));
    } catch (e) {
      if (e instanceof CapReached) {
        console.log(`stopping the sample: ${e.message}`);
        break;
      }
      throw e;
    }
    const exact = found.find((e) => fold(e.name) === fold(artist));
    const { pick } = pickArtist(artist, found);
    if (!exact || !pick || fold(pick.name) !== fold(artist)) {
      skipped.push({ title, reason: `${artist}: no exact artist match on Qloo` });
      continue;
    }
    seen.add(fold(artist));
    taken.push({ artist, qlooId: pick.id, title, revid: rev.revid, created, announced: ann[0], region, markets: by[region], source: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, "_"))}&oldid=${rev.revid}` });
    console.log(`taken ${taken.length}: ${artist} (${title}) ${REGIONS[region].name}, ${by[region].length} markets, created ${created}${ann[0] ? `, announced ${ann[0]}` : ""}`);
  }
  writeJson(`${DATA}/post-cutoff.json`, { rule: "data/outside2/PROTOCOL.md, test 3", cutoff: CUTOFF, size: POSTCUT_SIZE, walked, of: order.length, taken, skipped, alsoInHeadToHead: taken.filter((t) => h2hArtists.has(fold(t.artist))).map((t) => t.artist) });
  console.log(`post-cutoff: ${taken.length} taken, ${skipped.length} skipped, ${walked} of ${order.length} pages walked`);
}

/* ───────────────────────── stage: run ───────────────────────── */

const silent = () => {};
type Failing = { failed: boolean };
const logInto = (f: Failing) => (l: { failed?: boolean }) => {
  if (l.failed) f.failed = true;
};
const slim = (r: Room) => ({ id: r.id, name: r.name, affinity: r.affinity, popularity: r.popularity });

async function benchArtist(id: string): Promise<Artist> {
  const p = `${H2H_CACHE}/bench/${id}.json`;
  return readJson<TourRecord>(p).plan!.artist;
}

/** The artist as Qloo's search gives it (popularity and genres, which the opener lookup needs). */
async function qlooArtist(test: "support", name: string, qlooId: string): Promise<Artist | null> {
  const found = await spend(test, 1, null, () => cached(`${CACHE}/search/${slug(name)}.json`, async () => (await search(name, "urn:entity:artist", 5)).entities));
  const e = found.find((x) => x.id === qlooId) ?? found.find((x) => fold(x.name) === fold(name));
  if (!e) return null;
  return { id: e.id, name: e.name, popularity: e.popularity, genres: e.tags.filter((t) => /genre/.test(t.type ?? t.id)).map((t) => t.name).slice(0, 5), genreKeys: genresOf(e.tags) };
}

const VENUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { cities: { type: "array", items: { type: "object", additionalProperties: false, properties: { city_id: { type: "string" }, rooms: { type: "array", items: { type: "string" } } }, required: ["city_id", "rooms"] } } },
  required: ["cities"],
};
export const venuePrompt = `You are an experienced booking agent. Using only your own knowledge of the artist and the cities, name the venues where this artist would most likely play a headline show in each city given, for the crowd size given.
Rules: exactly 5 venues per city, most likely first, each a real venue in or near that city (its usual name, no address). One entry per city_id given.
Reply as JSON only.`;

const SUPPORT_SCHEMA = { type: "object", additionalProperties: false, properties: { artists: { type: "array", items: { type: "string" } } }, required: ["artists"] };
export const supportPrompt = `You are an experienced booking agent. Using only your own knowledge, name the artists most likely to be booked as the opening (support) act on this artist's headline tour of the region given.
Rules: exactly 5 artists, most likely first, never the headliner or a member of it.
Reply as JSON only.`;

/** scripts/head-to-head.ts rankPrompt, verbatim. */
export const rankPrompt = `You are an experienced booking agent. Using only your own knowledge of the artist and the cities, rank the cities in the region given where this artist would sell the most tickets for a headline show, strongest first.
Rules: exactly 50 cities, one entry per city (suburbs count as the city they belong to), each with its state, province or country, all in the region given.
Reply as JSON only.`;
const RANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { cities: { type: "array", items: { type: "object", additionalProperties: false, properties: { city: { type: "string" }, area: { type: "string" } }, required: ["city", "area"] } } },
  required: ["cities"],
};
const regionName = (r: RegionId) => (r === "eu" ? "mainland Europe (not the UK or Ireland)" : REGIONS[r].name);

/** A model call, retried once; null after two failures (reported as missing). */
async function modelCall<T>(test: "venues" | "support" | "postcut", need: { in: number; out: number }, path: string, fn: () => Promise<T>): Promise<T | null> {
  if (existsSync(path)) return readJson<T>(path);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const v = await spend(test, 0, need, fn);
      writeJson(path, v);
      return v;
    } catch (e) {
      if (e instanceof CapReached) throw e;
      console.error(`  model call failed (${attempt + 1}/2): ${(e as Error).message}`);
    }
  }
  return null;
}

/** Qloo places for a city without any artist signal, as lookUpRooms asks them (same tags, area and filters), by popularity. */
async function popularRooms(marketIdArg: string, draw: number): Promise<{ id: string; name: string; popularity?: number }[]> {
  const m = marketById(marketIdArg)!;
  const tier = venueTier(draw);
  const ask = async (tags: string[], take: number, keep: number) => {
    const r = await recommend({ type: "urn:entity:place", near: cityArea(m), tags, take });
    return r.entities
      .filter((e) => nearCity(e, m) && isRoom(e, draw) && !orchestraHallFor(e.name, []))
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
      .slice(0, keep)
      .map((e) => ({ id: e.id, name: e.name.replace(/\s+/g, " ").trim(), popularity: e.popularity }));
  };
  const rooms = await ask(tier.tags, 25, 14);
  if (draw >= BIG_ROOM_DRAW && !tier.tags.every((t) => BIG_ROOM_TAGS.includes(t))) {
    const big = (await ask(BIG_ROOM_TAGS, 15, 20)).filter((b) => !rooms.some((x) => x.id === b.id)).slice(0, 6);
    return [...rooms, ...big];
  }
  return rooms;
}
const callsFor = (draw: number) => (draw >= BIG_ROOM_DRAW && !venueTier(draw).tags.every((t) => BIG_ROOM_TAGS.includes(t)) ? 2 : 1);

async function runVenues() {
  const { subjects: vs } = readJson<{ subjects: VenueSubject[] }>(`${DATA}/venues-truth.json`);
  for (const v of vs) {
    const artist: Artist = v.benchId ? await benchArtist(v.benchId) : { id: v.qlooId!, name: v.artist, genres: [], genreKeys: [] };
    // Arm Q: Routed's own room lookup (lib/agent/tools.ts lookUpRooms) with the artist's signal. Genres are left
    // empty for every artist so the orchestra-hall rule is the same in both Qloo arms.
    const a: Artist = { ...artist, genres: [], genreKeys: [] };
    try {
      for (const c of v.cities) {
        const qp = `${CACHE}/venues/qloo/${slug(v.artist)}/${c.marketId}.json`;
        if (!existsSync(qp)) {
          const f = { failed: false };
          const rooms = await spend("venues", callsFor(v.draw), null, () => lookUpRooms(a, c.marketId, logInto(f), v.draw));
          if (f.failed) console.error(`  ${v.artist} ${c.city}: a Qloo room lookup failed; left for a retry`);
          else writeJson(qp, rooms.map(slim));
        }
        const pp = `${CACHE}/venues/popular/${c.marketId}-${v.draw >= 1 ? venueTier(v.draw).max : 0}.json`;
        if (!existsSync(pp)) {
          try {
            const rooms = await spend("venues", callsFor(v.draw), null, () => popularRooms(c.marketId, v.draw));
            writeJson(pp, { ok: true, rooms });
          } catch (e) {
            if (e instanceof CapReached) throw e;
            console.error(`  popularity-only ${c.city}: ${(e as Error).message}`);
            writeJson(pp, { ok: false, error: String((e as Error).message).slice(0, 200), rooms: [] });
          }
        }
        const lp = `${CACHE}/venues/ladder/${c.marketId}.json`;
        if (!existsSync(lp)) {
          const m = marketById(c.marketId)!;
          const rows = await wikidataRoomsNear({ lat: m.lat, lon: m.lon }, 30);
          if (rows) writeJson(lp, rows);
        }
      }
      const cities = v.cities.map((c) => ({ city_id: c.marketId, city: marketLabel(marketById(c.marketId)!) }));
      await modelCall("venues", { in: 400, out: 120 * cities.length + 100 }, `${CACHE}/venues/model/${slug(v.artist)}.json`, async () => {
        const { data, model } = await structured<{ cities: { city_id: string; rooms: string[] }[] }>(MODELS.agent, {
          name: "venues",
          schema: VENUE_SCHEMA,
          maxTokens: 1500,
          timeoutMs: 90_000,
          messages: [
            { role: "system", content: venuePrompt },
            { role: "user", content: `Artist: ${v.artist}.\nExpected crowd: about ${v.draw.toLocaleString("en-US")}.\nCities:\n${cities.map((c) => `${c.city_id} | ${c.city}`).join("\n")}` },
          ],
        });
        return { model, cities: data.cities };
      });
    } catch (e) {
      if (e instanceof CapReached) {
        console.log(`venues: stopping before ${v.artist}: ${e.message}`);
        return;
      }
      throw e;
    }
    const l = ledger();
    console.log(`venues ${v.artist.padEnd(30)} done | Qloo ${l.qloo.venues ?? 0}/${QLOO_CAP.venues}, model $${dollars(l).toFixed(3)}`);
  }
}

async function runSupport() {
  const { subjects: ss } = readJson<{ subjects: SupportSubject[] }>(`${DATA}/support-truth.json`);
  for (const s of ss) {
    try {
      const qp = `${CACHE}/support/qloo/${slug(s.artist)}.json`;
      if (!existsSync(qp)) {
        const artist = s.benchId ? await benchArtist(s.benchId) : await qlooArtist("support", s.artist, s.qlooId!);
        if (!artist) {
          writeJson(qp, { ok: false, reason: "the artist wasn't found again on Qloo", cities: [] });
        } else {
          const per: { marketId: string; openers: { id: string; name: string; affinity?: number }[] }[] = [];
          let failed = false;
          for (const id of s.cities) {
            const f = { failed: false };
            const o: Opener[] = await spend("support", 1, null, () => lookUpOpeners(artist, id, logInto(f)));
            if (f.failed) failed = true;
            per.push({ marketId: id, openers: o.map((x) => ({ id: x.id, name: x.name, affinity: x.affinity })) });
          }
          if (failed) console.error(`  ${s.artist}: an opener lookup failed; left for a retry`);
          else writeJson(qp, { ok: true, cities: per });
        }
      }
      await modelCall("support", { in: 150, out: 80 }, `${CACHE}/support/model/${slug(s.artist)}.json`, async () => {
        const { data, model } = await structured<{ artists: string[] }>(MODELS.agent, {
          name: "support",
          schema: SUPPORT_SCHEMA,
          maxTokens: 400,
          timeoutMs: 60_000,
          messages: [
            { role: "system", content: supportPrompt },
            { role: "user", content: `Artist: ${s.artist}.\nRegion: ${regionName(s.region)}.` },
          ],
        });
        return { model, artists: data.artists };
      });
    } catch (e) {
      if (e instanceof CapReached) {
        console.log(`support: stopping before ${s.artist}: ${e.message}`);
        return;
      }
      throw e;
    }
    const l = ledger();
    console.log(`support ${s.artist.padEnd(30)} done | Qloo ${l.qloo.support ?? 0}/${QLOO_CAP.support}, model $${dollars(l).toFixed(3)}`);
  }
}

async function runPostcut() {
  if (!existsSync(`${DATA}/post-cutoff.json`)) return console.log("post-cutoff: run the sample stage first");
  const { taken } = readJson<{ taken: PostCut[] }>(`${DATA}/post-cutoff.json`);
  for (const t of taken) {
    try {
      const qp = `${CACHE}/postcut/qloo/${slug(t.artist)}.json`;
      if (!existsSync(qp)) {
        const cities = await spend("postcut", 1, null, async () => scoreCities((await wherePopular(t.qlooId, HEAT_AREAS[t.region][0]!.within, 50)).tiles, t.region));
        writeJson(qp, { ids: cities.map((c: CityScore) => c.marketId) });
      }
      await modelCall("postcut", { in: 200, out: 1600 }, `${CACHE}/postcut/model/${slug(t.artist)}.json`, async () => {
        const { data, model } = await structured<{ cities: { city: string; area: string }[] }>(MODELS.agent, {
          name: "ranking",
          schema: RANK_SCHEMA,
          maxTokens: 3000,
          timeoutMs: 90_000,
          messages: [
            { role: "system", content: rankPrompt },
            { role: "user", content: `Artist: ${t.artist}.\nRegion: ${regionName(t.region)}.` },
          ],
        });
        return { model, named: (data.cities ?? []).slice(0, 50) };
      });
    } catch (e) {
      if (e instanceof CapReached) {
        console.log(`post-cutoff: stopping before ${t.artist}: ${e.message}`);
        return;
      }
      throw e;
    }
    const l = ledger();
    console.log(`post-cutoff ${t.artist.padEnd(28)} done | Qloo ${(l.qloo.sample ?? 0) + (l.qloo.postcut ?? 0)}/${QLOO_CAP.postcut}, model $${dollars(l).toFixed(3)}`);
  }
}

async function run() {
  const which = process.argv[3];
  if (!which || which === "venues") await runVenues();
  if (!which || which === "support") await runSupport();
  if (!which || which === "postcut") await runPostcut();
  const l = ledger();
  console.log(`ledger: Qloo ${JSON.stringify(l.qloo)} (total ${qlooTotal(l)}), model calls ${l.modelCalls}, tokens ${l.tokensIn} in / ${l.tokensOut} out, about $${dollars(l).toFixed(3)}`);
}

/* ───────────────────────── stage: score ───────────────────────── */

function contrast(name: string, a: number[], b: number[]) {
  const d = a.map((x, i) => x - b[i]!);
  const st = signTest(d);
  const ci = meanCI(d, SEED);
  return { name, n: d.length, meanA: avg(a), meanB: avg(b), diff: ci.mean, lo: ci.lo, hi: ci.hi, wins: st.wins, losses: st.losses, ties: st.ties, p: st.p };
}
type Contrast = ReturnType<typeof contrast>;
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(1)}`;
const pv = (p: number) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
const row = (c: Contrast) => `| ${c.name} | ${c.n} | ${pct(c.meanA)} | ${pct(c.meanB)} | ${pts(c.diff)} [${pts(c.lo)}, ${pts(c.hi)}] | ${c.wins}–${c.losses}–${c.ties} | ${pv(c.p)} |`;
const HEAD = "| Contrast | n | A | B | A − B, pts [95% CI] | wins–losses–ties | sign test p |\n|---|---|---|---|---|---|---|";

const ARMS = ["qloo", "routedOrder", "popular", "ladder", "model"] as const;
type Arm = (typeof ARMS)[number];
const ARM_NAME: Record<Arm, string> = { qloo: "Qloo, the artist's room ranking", routedOrder: "Qloo's rooms in Routed's measuring order", popular: "Qloo places by popularity (no artist)", ladder: "Biggest fitting room on Wikidata", model: "Nemotron 3 Ultra alone" };

function ladderList(marketIdArg: string, draw: number): string[] | null {
  const p = `${CACHE}/venues/ladder/${marketIdArg}.json`;
  if (!existsSync(p)) return null;
  const all = roomLadder(readJson(p), draw);
  const fit = ladderTier(all, draw).sort((a, b) => b.capacity - a.capacity);
  const rest = all.filter((r) => !fit.includes(r)).sort((a, b) => Math.abs(Math.log(a.capacity / draw)) - Math.abs(Math.log(b.capacity / draw)));
  return [...fit, ...rest].map((r) => r.name);
}

function scoreVenues() {
  const { subjects: vs, skipped } = readJson<{ subjects: VenueSubject[]; skipped: unknown[] }>(`${DATA}/venues-truth.json`);
  const rows: any[] = [];
  const missing: { artist: string; reason: string }[] = [];
  let popularDown = 0;
  for (const v of vs) {
    const mp = `${CACHE}/venues/model/${slug(v.artist)}.json`;
    const model = existsSync(mp) ? readJson<{ model: string; cities: { city_id: string; rooms: string[] }[] }>(mp) : null;
    const cities: any[] = [];
    let ok = true;
    for (const c of v.cities) {
      const qp = `${CACHE}/venues/qloo/${slug(v.artist)}/${c.marketId}.json`;
      const pp = `${CACHE}/venues/popular/${c.marketId}-${venueTier(v.draw).max}.json`;
      const q = existsSync(qp) ? readJson<{ id: string; name: string; affinity?: number; popularity?: number }[]>(qp) : null;
      const pop = existsSync(pp) ? readJson<{ ok: boolean; rooms: { name: string }[] }>(pp) : null;
      const lad = ladderList(c.marketId, v.draw);
      const mod = model?.cities.find((x) => x.city_id === c.marketId)?.rooms ?? (model ? [] : null);
      if (!q || !pop || !model) {
        ok = false;
        break;
      }
      if (!pop.ok) popularDown++;
      const real = c.venues.map((x) => x.names);
      const lists: Record<Arm, string[] | null> = {
        qloo: q.map((x) => x.name),
        routedOrder: candidatesBySize(q.map((x) => ({ ...x, tags: [] }) as Room), v.draw).map((x) => x.name),
        popular: pop.ok ? pop.rooms.map((x) => x.name) : null,
        ladder: lad,
        model: mod!.slice(0, 5),
      };
      const ranks = Object.fromEntries(ARMS.map((k) => [k, lists[k] ? rankOf(lists[k]!, real) : null])) as Record<Arm, number | null>;
      cities.push({ marketId: c.marketId, city: c.city, real: c.venues.map((x) => x.names[0]), ranks, top: Object.fromEntries(ARMS.map((k) => [k, lists[k] ? lists[k]!.slice(0, K) : null])), returned: { qloo: q.length, popular: pop.ok ? pop.rooms.length : null, ladder: lad?.length ?? null } });
    }
    if (!ok) {
      missing.push({ artist: v.artist, reason: "a Qloo lookup or the model call is missing (cap reached or failed twice)" });
      continue;
    }
    const share = (k: Arm, f: (r: number | null) => number) => avg(cities.map((c) => f(c.ranks[k])));
    const hit = (n: number) => (r: number | null) => (r !== null && r <= n ? 1 : 0);
    const rr = (r: number | null) => (r !== null && r <= 5 ? 1 / r : 0);
    rows.push({
      artist: v.artist,
      set: v.set,
      region: v.region,
      tour: v.tour,
      source: v.source,
      draw: v.draw,
      cities,
      hit3: Object.fromEntries(ARMS.map((k) => [k, share(k, hit(3))])),
      hit1: Object.fromEntries(ARMS.map((k) => [k, share(k, hit(1))])),
      mrr5: Object.fromEntries(ARMS.map((k) => [k, share(k, rr)])),
    });
  }
  const has = (k: Arm) => rows.filter((r) => r.cities.every((c: any) => c.top[k] !== null));
  const pair = (name: string, a: Arm, b: Arm, metric: "hit3" | "hit1" | "mrr5" = "hit3") => {
    const xs = rows.filter((r) => r.cities.every((c: any) => c.top[a] !== null && c.top[b] !== null));
    return contrast(name, xs.map((r) => r[metric][a]), xs.map((r) => r[metric][b]));
  };
  const pooled = Object.fromEntries(
    ARMS.map((k) => {
      const xs = has(k).flatMap((r) => r.cities);
      return [k, { cities: xs.length, hit1: xs.filter((c: any) => c.ranks[k] === 1).length, hit3: xs.filter((c: any) => c.ranks[k] !== null && c.ranks[k] <= 3).length, listed: xs.filter((c: any) => c.ranks[k] !== null).length, medianRank: median(xs.map((c: any) => c.ranks[k]).filter((x: number | null): x is number => x !== null)) }];
    }),
  );
  return {
    n: rows.length,
    cities: rows.reduce((n, r) => n + r.cities.length, 0),
    popularityOnlyUnavailable: popularDown,
    primary: [pair("Qloo (artist signal) vs Qloo popularity only", "qloo", "popular"), pair("Qloo vs the model alone", "qloo", "model")],
    secondary: [
      pair("The model alone vs Qloo popularity only", "model", "popular"),
      pair("Qloo vs the biggest fitting Wikidata room", "qloo", "ladder"),
      pair("The model alone vs the biggest fitting Wikidata room", "model", "ladder"),
      pair("Qloo in Routed's measuring order vs Qloo popularity only", "routedOrder", "popular"),
      pair("Qloo, hit@1, vs the model alone", "qloo", "model", "hit1"),
      pair("Qloo, MRR@5, vs the model alone", "qloo", "model", "mrr5"),
      pair("Qloo, hit@1, vs Qloo popularity only", "qloo", "popular", "hit1"),
    ],
    pooled,
    rows,
    missing,
    skipped,
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

function scoreSupport() {
  const { subjects: ss, skipped } = readJson<{ subjects: SupportSubject[]; skipped: unknown[] }>(`${DATA}/support-truth.json`);
  const rows: any[] = [];
  const missing: { artist: string; reason: string }[] = [];
  for (const s of ss) {
    const qp = `${CACHE}/support/qloo/${slug(s.artist)}.json`;
    const mp = `${CACHE}/support/model/${slug(s.artist)}.json`;
    if (!existsSync(qp) || !existsSync(mp)) {
      missing.push({ artist: s.artist, reason: "the Qloo lookups or the model call are missing (cap reached or failed twice)" });
      continue;
    }
    const q = readJson<{ ok: boolean; reason?: string; cities: { openers: { id: string; name: string; affinity?: number }[] }[] }>(qp);
    if (!q.ok) {
      missing.push({ artist: s.artist, reason: q.reason ?? "Qloo lookup failed" });
      continue;
    }
    // pickSupport's order with no agent votes: seen in the most cities, then the higher summed affinity.
    const tally = new Map<string, { name: string; seen: number; aff: number; first: number }>();
    let i = 0;
    for (const c of q.cities)
      for (const o of c.openers) {
        const t = tally.get(o.id) ?? { name: o.name, seen: 0, aff: 0, first: i++ };
        t.seen++;
        t.aff += o.affinity ?? 0;
        tally.set(o.id, t);
      }
    const qloo = [...tally.values()].sort((a, b) => b.seen - a.seen || b.aff - a.aff || a.first - b.first).map((t) => t.name).slice(0, 5);
    const model = readJson<{ artists: string[] }>(mp).artists.filter((x) => fold(x) !== fold(s.artist)).slice(0, 5);
    const truth = s.openers.map((o) => o.names);
    const rank = (xs: string[]) => {
      for (let j = 0; j < xs.length; j++) if (truth.some((names) => names.some((n) => fold(n) === fold(xs[j]!)))) return j + 1;
      return null;
    };
    const rq = rank(qloo), rm = rank(model);
    rows.push({ artist: s.artist, set: s.set, region: s.region, tour: s.tour, source: s.source, from: s.from, openers: s.openers.map((o) => o.names[0]), qloo, model, rank: { qloo: rq, model: rm }, hit5: { qloo: rq ? 1 : 0, model: rm ? 1 : 0 }, hit1: { qloo: rq === 1 ? 1 : 0, model: rm === 1 ? 1 : 0 }, qlooReturned: qloo.length });
  }
  return {
    n: rows.length,
    primary: [contrast("Qloo's support pick (hit@5) vs the model's", rows.map((r) => r.hit5.qloo), rows.map((r) => r.hit5.model))],
    secondary: [contrast("Qloo's support pick (hit@1) vs the model's", rows.map((r) => r.hit1.qloo), rows.map((r) => r.hit1.model))],
    pooled: { qloo: rows.filter((r) => r.hit5.qloo).length, model: rows.filter((r) => r.hit5.model).length, qlooTop1: rows.filter((r) => r.hit1.qloo).length, modelTop1: rows.filter((r) => r.hit1.model).length, qlooUnderFive: rows.filter((r) => r.qlooReturned < 5).length },
    rows,
    missing,
    skipped,
  };
}

async function placeModelCities(named: { city: string; area: string }[], region: RegionId): Promise<(string | null)[]> {
  const byName = named.map((c) => findMarket(`${c.city}, ${c.area}`, region) ?? findMarket(c.city, region));
  const titles = (c: { city: string; area: string }) => {
    const a = c.area.trim();
    const full = US_STATES[a.toUpperCase()] ? US_STATES[a.toUpperCase()]!.replace(/(^|\s)\w/g, (x: string) => x.toUpperCase()) : Object.entries(CA_ABBR).find(([, v]) => v === a.toUpperCase())?.[0] ?? a;
    return region === "na" ? [`${c.city}, ${full}`, c.city] : [c.city, `${c.city}, ${a}`];
  };
  const want = [...new Set(named.filter((_, i) => !byName[i]).flatMap(titles))];
  const at = await coordinates(want);
  return named.map((c, i) => {
    if (byName[i]) return marketId(byName[i]!);
    for (const t of titles(c)) {
      const p = at[t];
      const m = p ? nearestMarket({ lat: p[0], lon: p[1] }, region, 60) : null;
      if (m) return marketId(m);
    }
    return null;
  });
}

async function scorePostcut() {
  if (!existsSync(`${DATA}/post-cutoff.json`)) return null;
  const pc = readJson<{ taken: PostCut[]; skipped: unknown[]; walked: number; of: number }>(`${DATA}/post-cutoff.json`);
  const rows: any[] = [];
  const missing: { artist: string; reason: string }[] = [];
  const label = (id: string) => marketById(id)?.name ?? id;
  for (const t of pc.taken) {
    const qp = `${CACHE}/postcut/qloo/${slug(t.artist)}.json`;
    const mp = `${CACHE}/postcut/model/${slug(t.artist)}.json`;
    if (!existsSync(qp) || !existsSync(mp)) {
      missing.push({ artist: t.artist, reason: "the heatmap or the model call is missing (cap reached or failed twice)" });
      continue;
    }
    const truth = new Set(t.markets);
    const q = readJson<{ ids: string[] }>(qp).ids;
    const m = readJson<{ named: { city: string; area: string }[] }>(mp).named;
    const mids = await placeModelCities(m, t.region);
    const P = populationRanking(t.region), Q = completeRanking(q, t.region), M = completeRanking(mids, t.region), B = blendRanking(q, t.region);
    const pack = (h: { hits: number; of: number; ids: string[] }) => ({ hits: h.hits, of: h.of, cities: h.ids.map(label) });
    rows.push({
      artist: t.artist,
      region: t.region,
      tour: t.title,
      source: t.source,
      announced: t.announced ?? null,
      created: t.created,
      R: truth.size,
      modelUnplaced: mids.filter((x) => !x).length,
      rp: { population: pack(rPrecision(P, truth)), model: pack(rPrecision(M, truth)), qloo: pack(rPrecision(Q, truth)), blend: pack(rPrecision(B, truth)), modelQloo: pack(rPrecision(blendTwo(M, q, t.region), truth)) },
      beyond: { model: pack(beyondBiggest(M, truth, t.region)), qloo: pack(beyondBiggest(Q, truth, t.region)), blend: pack(beyondBiggest(B, truth, t.region)) },
    });
  }
  const sh = (h: { hits: number; of: number }) => (h.of ? h.hits / h.of : 0);
  const v = (k: string) => rows.map((r) => sh(r.rp[k]));
  const pool = (k: string, f: "rp" | "beyond" = "rp") => {
    const hits = rows.reduce((n, r) => n + r[f][k].hits, 0), of = rows.reduce((n, r) => n + r[f][k].of, 0);
    return { hits, of, share: of ? hits / of : 0 };
  };
  return {
    n: rows.length,
    qualifying: pc.taken.length,
    walked: pc.walked,
    of: pc.of,
    belowMinimum: pc.taken.length < POSTCUT_MIN,
    primary: [contrast("Qloo vs the model alone", v("qloo"), v("model")), contrast("Qloo + population vs population", v("blend"), v("population"))],
    secondary: [contrast("The model alone vs population", v("model"), v("population")), contrast("Qloo vs population", v("qloo"), v("population")), contrast("Qloo + population vs the model alone", v("blend"), v("model"))],
    exploratory: [contrast("The model + Qloo vs the model alone", v("modelQloo"), v("model"))],
    pooled: Object.fromEntries(["population", "model", "qloo", "blend", "modelQloo"].map((k) => [k, pool(k)])),
    beyond: Object.fromEntries(["model", "qloo", "blend"].map((k) => [k, pool(k, "beyond")])),
    rows,
    missing,
  };
}

async function score() {
  const venues = scoreVenues();
  const support = scoreSupport();
  const postcut = await scorePostcut();
  const l = ledger();
  // Model answers are ours to publish; Qloo's raw responses stay in the gitignored cache.
  const modelRuns = {
    prompts: { venues: venuePrompt, support: supportPrompt, postcut: rankPrompt },
    venues: venues.rows.map((r: any) => ({ artist: r.artist, ...readJson<object>(`${CACHE}/venues/model/${slug(r.artist)}.json`) })),
    support: support.rows.map((r: any) => ({ artist: r.artist, ...readJson<object>(`${CACHE}/support/model/${slug(r.artist)}.json`) })),
    postcut: postcut ? postcut.rows.map((r: any) => ({ artist: r.artist, ...readJson<object>(`${CACHE}/postcut/model/${slug(r.artist)}.json`) })) : [],
  };
  writeJson(`${DATA}/model-runs.json`, modelRuns);
  const usage = { qloo: l.qloo, qlooTotal: qlooTotal(l), modelCalls: l.modelCalls, tokensIn: l.tokensIn, tokensOut: l.tokensOut, dollars: Math.round(dollars(l) * 1000) / 1000 };
  writeJson(`${DATA}/results.json`, { scored: new Date().toISOString(), protocol: "data/outside2/PROTOCOL.md", script: "scripts/outside2.ts", model: "nvidia/Nemotron-3-Ultra-550b-a55b", usage, venues, support, postcut });

  const out: string[] = [];
  out.push(`### Test 1, venues (n = ${venues.n} artists, ${venues.cities} cities; hit@${K} per city, averaged per artist)\n`, HEAD, ...venues.primary.map(row), ...venues.secondary.map(row));
  out.push(`\n| Method | cities | real venue #1 | in top 3 | listed at all | median rank when listed |\n|---|---|---|---|---|---|`);
  for (const k of ARMS) {
    const p = (venues.pooled as any)[k];
    out.push(`| ${ARM_NAME[k]} | ${p.cities} | ${p.hit1} | ${p.hit3} | ${p.listed} | ${p.medianRank ?? "–"} |`);
  }
  out.push(`\n### Test 2, support acts (n = ${support.n} artists)\n`, HEAD, ...support.primary.map(row), ...support.secondary.map(row));
  out.push(`\nPooled: Qloo found a real opener in its top 5 for ${support.pooled.qloo} of ${support.n}, the model for ${support.pooled.model}; at #1, ${support.pooled.qlooTop1} and ${support.pooled.modelTop1}.`);
  if (postcut) {
    out.push(`\n### Test 3, post-cutoff tours (n = ${postcut.n} of ${postcut.qualifying} qualifying; R-precision)\n`, HEAD, ...postcut.primary.map(row), ...postcut.secondary.map(row), ...postcut.exploratory.map(row));
    out.push(`\n| Ranking | hits / picks | share |\n|---|---|---|`);
    for (const [k, p] of Object.entries(postcut.pooled)) out.push(`| ${k} | ${(p as any).hits} / ${(p as any).of} | ${pct((p as any).share)} |`);
  }
  out.push(`\nUsage: Qloo ${JSON.stringify(usage.qloo)} = ${usage.qlooTotal} requests; model ${usage.modelCalls} calls, ${usage.tokensIn} in / ${usage.tokensOut} out, about $${usage.dollars}.`);
  writeFileSync(`${CACHE}/tables.md`, out.join("\n") + "\n");
  console.log(out.join("\n"));
}

const stage = process.argv[2];
if (stage === "truth") await truth();
else if (stage === "sample") await sample();
else if (stage === "run") await run();
else if (stage === "score") await score();
else console.log("stages: truth | sample | run [venues|support|postcut] | score");
