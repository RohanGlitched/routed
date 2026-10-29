// Outside tests, round 4: the room Routed actually books. The protocol is data/outside2/PROTOCOL-4.md, committed
// with this file before any Qloo call for this test ran.
//
// Usage (from routed/; the Qloo key is read from .env.local by the loader below, never printed):
//   node --conditions=react-server --import tsx scripts/rooms4.ts run     # Qloo name searches + Wikidata, capped at 320 Qloo requests
//   node --conditions=react-server --import tsx scripts/rooms4.ts score   # data/outside2/rooms4.json
//
// Raw Qloo responses and ids stay in .probe/outside2/rooms4 (gitignored); the published file carries room names,
// ranks, hit counts and Wikidata capacities only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RegionId } from "../lib/geo/markets.ts";
import type { Artist, Capacity, Room, Usage } from "../lib/types.ts";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  const want = new Set(["QLOO_API_KEY", "QLOO_BASE_URL"]);
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m || !want.has(m[1]!) || process.env[m[1]!]) continue;
    process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const { marketById, marketLabel } = await import("../lib/geo/markets.ts");
const { avg, meanCI, signTest } = await import("../lib/headtohead.ts");
const { newUsage, withUsage } = await import("../lib/usage.ts");
const { findPlace, scoreRooms } = await import("../lib/agent/tools.ts");
const { search } = await import("../lib/qloo.ts");
const { BIG_ROOM_DRAW, candidatesBySize, concertRoom, ladderTier, mergeLadder, pickArtist, roomCheck, roomFit, roomGrade, roomLadder, roomNameOk, sizePrior, venueTier } = await import("../lib/agent/rooms.ts");
const { LADDER_DRAW, MEASURE_BATCH, MEASURE_PER_CITY, NAMED_PER_CITY, PRE_MEASURE, placeWords, roomNameMatches } = await import("../lib/agent/plan.ts");
const { capacityOverride } = await import("../lib/agent/capacity.ts");
const { fit } = await import("../lib/agent/evidence.ts");
const { wikidataCapacity } = await import("../lib/wikidata.ts");
const { popularityAffinityOrder } = await import("../lib/roomorder.ts");
type LadderRoom = import("../lib/agent/rooms.ts").LadderRoom;

/* ───────────────────────── fixed parameters (PROTOCOL-4.md) ───────────────────────── */

const DATA = "data/outside2";
const O2 = ".probe/outside2";
const CACHE = ".probe/outside2/rooms4";
const H2H_CACHE = ".probe/h2h";
const QLOO_CAP = 320;
const SEED = 20261025;
const OUT = `${DATA}/rooms4.json`;

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
const slug = (s: string) => fold(s).replace(/ /g, "-");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 20);
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const writeJson = (p: string, v: unknown) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 1) + "\n");
};

/* ───────────────────────── round 2's matching rule (scripts/outside2.ts sameRoom), copied ───────────────────────── */

const GENERIC = new Set(["the", "and", "club", "hall", "theatre", "theater", "room", "bar", "music", "venue", "center", "centre", "arts", "performing", "auditorium", "house", "ballroom", "arena", "amphitheater", "amphitheatre", "live", "concert", "stage", "at", "of"]);
const distinct = (s: string) => new Set(fold(s).split(" ").filter((w) => w.length > 1 && !GENERIC.has(w)));
function sameRoom(a: string, b: string): boolean {
  if (!fold(a) || !fold(b)) return false;
  if (fold(a) === fold(b)) return true;
  const x = distinct(a), y = distinct(b);
  const [s, l] = x.size <= y.size ? [x, y] : [y, x];
  if (!s.size) return false;
  if (![...s].every((w) => l.has(w))) return false;
  return s.size >= 2 || l.size <= 2;
}
function rankOf(listed: string[], real: string[][]): number | null {
  for (let i = 0; i < listed.length; i++) if (real.some((names) => names.some((n) => sameRoom(n, listed[i]!)))) return i + 1;
  return null;
}

/* ───────────────────────── the Qloo ledger and cap ───────────────────────── */

const LEDGER = `${CACHE}/usage.json`;
const ledger = (): { qloo: number; steps: number } => (existsSync(LEDGER) ? readJson(LEDGER) : { qloo: 0, steps: 0 });
class CapReached extends Error {}
/** A Qloo step that failed (not "not found"): nothing is cached, and the artist is left for a rerun. */
class StepFailed extends Error {}

/** Runs one Qloo step, refusing it when its worst case could pass the cap, and adds what it really spent to the ledger. */
async function spend<T>(need: number, fn: () => Promise<T>): Promise<T> {
  const l = ledger();
  if (l.qloo + need > QLOO_CAP) throw new CapReached(`Qloo cap (${l.qloo}/${QLOO_CAP}, next step needs up to ${need})`);
  const u: Usage = newUsage();
  try {
    return await withUsage(u, fn);
  } finally {
    const now = ledger();
    writeJson(LEDGER, { qloo: now.qloo + u.qloo, steps: now.steps + 1 });
  }
}

/** A cached step: the answer on disk is reused (null included), so a rerun costs nothing for work already done. */
async function cachedStep<T>(path: string, need: number, fn: () => Promise<T>): Promise<T> {
  if (existsSync(path)) return readJson<{ v: T }>(path).v;
  const v = await spend(need, fn);
  writeJson(path, { v });
  return v;
}

/* ───────────────────────── subjects ───────────────────────── */

type VenueCity = { marketId: string; city: string; venues: { names: string[]; qid?: string; capacity?: number }[] };
type VenueSubject = { artist: string; set: "bench" | "held-out"; region: RegionId; tour: string; source: string; qlooId?: string; benchId?: string; draw: number; cities: VenueCity[] };
type Slim = { id: string; name: string; affinity?: number; popularity?: number };

const subjects = () => readJson<{ subjects: VenueSubject[] }>(`${DATA}/venues-truth.json`).subjects;
const modelVenues = (artist: string) => readJson<{ venues: { artist: string; cities: { city_id: string; rooms: string[] }[] }[] }>(`${DATA}/model-runs.json`).venues.find((x) => x.artist === artist);
const qlooList = (artist: string, marketId: string): Slim[] | null => {
  const p = `${O2}/venues/qloo/${slug(artist)}/${marketId}.json`;
  return existsSync(p) ? readJson<Slim[]>(p) : null;
};
const ladderRows = (marketId: string): LadderRoom[] => {
  const p = `${O2}/venues/ladder/${marketId}.json`;
  return existsSync(p) ? readJson<LadderRoom[]>(p) : [];
};

/**
 * The artist as round 2 used it (cached: the bench tour's record, or round 2's Qloo search), genres left empty; for
 * an artist round 2 found through the head-to-head's stripped ids, one Qloo search by name (PROTOCOL-4.md, amendment 1).
 */
async function artistOf(v: VenueSubject): Promise<Artist | null> {
  const cachedArtist = artistFromCache(v);
  if (cachedArtist) return cachedArtist;
  const found = await cachedStep<{ id: string; name: string; popularity?: number }[]>(`${CACHE}/artist/${slug(v.artist)}.json`, 1, async () =>
    (await search(v.artist, "urn:entity:artist", 5).catch((e: Error) => Promise.reject(new StepFailed(`artist search: ${e.message}`)))).entities.map((e) => ({ id: e.id, name: e.name, popularity: e.popularity })),
  );
  const e = found.find((x) => fold(x.name) === fold(v.artist)) ?? pickArtist(v.artist, found).pick;
  return e ? { id: e.id, name: e.name, popularity: e.popularity, genres: [], genreKeys: [] } : null;
}

function artistFromCache(v: VenueSubject): Artist | null {
  if (v.benchId) {
    const p = `${H2H_CACHE}/bench/${v.benchId}.json`;
    if (!existsSync(p)) return null;
    const a = readJson<{ plan: { artist: Artist } }>(p).plan.artist;
    return { ...a, genres: [], genreKeys: [] };
  }
  const p = `${O2}/search/${slug(v.artist)}.json`;
  if (!existsSync(p)) return null;
  const found = readJson<{ id: string; name: string; popularity?: number }[]>(p);
  const e = found.find((x) => x.id === v.qlooId) ?? found.find((x) => fold(x.name) === fold(v.artist)) ?? pickArtist(v.artist, found).pick;
  return e ? { id: e.id, name: e.name, popularity: e.popularity, genres: [], genreKeys: [] } : null;
}

/* ───────────────────────── capacities: overrides, Wikidata, the market's ladder ───────────────────────── */

async function capacityOf(room: Room, label: string, ladder: LadderRoom[]): Promise<Capacity | null> {
  const fixed = capacityOverride(room.name, label);
  if (fixed) return fixed;
  const p = `${CACHE}/cap/${sha(`${room.name}|${label}|${room.lat ?? ""},${room.lon ?? ""}`)}.json`;
  if (existsSync(p)) return readJson<{ v: Capacity | null }>(p).v;
  const near = room.lat !== undefined && room.lon !== undefined ? { lat: room.lat, lon: room.lon } : undefined;
  let wiki = await wikidataCapacity(room.name, label, near);
  if (wiki === undefined) wiki = await wikidataCapacity(room.name, label, near); // one retry when Wikidata couldn't be asked
  if (wiki === undefined) return null; // not cached: a later run asks again
  const found: Capacity | null = wiki ?? mergeLadder([{ ...room, capacity: undefined }], roomLadder(ladder)).rooms[0]!.capacity ?? null;
  writeJson(p, { v: found });
  return found;
}

/* ───────────────────────── the shipped arm: lib/agent/plan.ts replayed for one artist ───────────────────────── */

type CityState = {
  marketId: string;
  rooms: (Room & { measured?: boolean })[];
  choice?: string;
  first?: string;
  booked?: string;
  bookable: boolean;
  status: string;
  ladderUsed: boolean;
};

async function shipped(v: VenueSubject, artist: Artist): Promise<CityState[]> {
  const draw = v.draw;
  const model = modelVenues(v.artist);
  if (!model) throw new Error(`${v.artist}: no model answer`);
  const lists = new Map<string, Room[]>();
  for (const c of v.cities) {
    const q = qlooList(v.artist, c.marketId);
    if (!q) throw new Error(`${v.artist} ${c.city}: no cached Qloo list`);
    lists.set(c.marketId, q.map((x) => ({ id: x.id, name: x.name, affinity: x.affinity, popularity: x.popularity, tags: [] })));
  }

  // 1. The agent's named rooms (its first NAMED_PER_CITY names), found on Qloo by name in the city.
  const choice = new Map<string, string>();
  const found: { marketId: string; room: Room }[] = [];
  for (const c of v.cities) {
    const list = lists.get(c.marketId)!;
    const place = placeWords(marketById(c.marketId));
    const names = [...new Set((model.cities.find((x) => x.city_id === c.marketId)?.rooms ?? []).map((x) => x.trim()).filter(Boolean))].slice(0, NAMED_PER_CITY);
    for (const name of names) {
      const on = list.find((r) => roomNameMatches(name, r.name, place));
      if (on) {
        if (!choice.has(c.marketId)) choice.set(c.marketId, on.id);
        continue;
      }
      const r = await cachedStep<Room | null>(`${CACHE}/find/${sha(`${name}|${c.marketId}|${draw}`)}.json`, 2, () => findPlace(artist, name, c.marketId, draw).catch((e: Error) => Promise.reject(new StepFailed(`${name} in ${c.city}: ${e.message}`))));
      if (!r || !roomNameMatches(name, r.name, place)) continue;
      if (list.some((x) => x.id === r.id) || found.some((f) => f.room.id === r.id)) {
        if (!choice.has(c.marketId)) choice.set(c.marketId, r.id);
        continue;
      }
      found.push({ marketId: c.marketId, room: { ...r, origin: "agent" } });
      if (!choice.has(c.marketId)) choice.set(c.marketId, r.id);
    }
  }
  if (found.length) {
    const ids = found.map((f) => f.room.id);
    const aff = await cachedStep<[string, number][]>(`${CACHE}/score/${sha([artist.id, ...ids].join("|"))}.json`, 1, async () => [...(await scoreRooms(artist, ids).catch((e: Error) => Promise.reject(new StepFailed(`scoreRooms: ${e.message}`))))]);
    const m = new Map(aff);
    for (const f of found) if (m.has(f.room.id)) f.room.affinity = m.get(f.room.id);
  }
  for (const f of found) {
    const list = lists.get(f.marketId)!;
    const at = f.room.affinity === undefined ? list.length : list.findIndex((x) => (x.affinity ?? 0) < f.room.affinity!);
    list.splice(at < 0 ? list.length : at, 0, f.room);
  }

  const out: CityState[] = [];
  for (const c of v.cities) {
    const m = marketById(c.marketId)!;
    const label = marketLabel(m);
    const place = placeWords(m);
    const rows = ladderRows(c.marketId);
    const list = lists.get(c.marketId)!;
    const measured = new Set<string>();
    const measure = async (room: Room) => {
      if (room.capacity !== undefined || measured.has(room.id)) return;
      measured.add(room.id);
      const cap = await capacityOf(room, label, rows);
      if (cap) room.capacity = cap;
    };
    const worth = (r: Room) => !draw || draw < BIG_ROOM_DRAW || (sizePrior(r) !== "small" && roomNameOk(r.name, draw));
    const inOrder = async (order: Room[]) => {
      for (let i = 0; i < order.length; i += MEASURE_BATCH) {
        const batch = order.slice(i, i + MEASURE_BATCH);
        for (const r of batch) await measure(r);
        if (batch.some((r) => roomFit(r, draw) === "close")) break;
      }
    };
    // 2. Before booking: the agent's rooms, then the likeliest of the rest, until a close fit.
    await inOrder([...list.filter((r) => r.origin === "agent"), ...candidatesBySize(list.filter((r) => r.origin !== "agent" && worth(r)), draw).slice(0, PRE_MEASURE)]);
    // 3. The chosen room (or the first worth measuring), then up to MEASURE_PER_CITY more until a close fit.
    const want = choice.get(c.marketId);
    const first = list.find((x) => x.id === want) ?? list.find(worth) ?? list[0];
    if (first) await measure(first);
    if (first && roomFit(first, draw) !== "close") await inOrder(candidatesBySize(list.filter((x) => x !== first && worth(x)), draw).slice(0, MEASURE_PER_CITY));
    let check = roomCheck(list, want ?? first?.id, draw);
    // 4. No one-night fit: the city's Wikidata rooms at the right size, each found on Qloo first (addLadderRooms).
    let ladderUsed = false;
    if (!check.bookable || (draw >= LADDER_DRAW && !roomFit(check.room!, draw))) {
      ladderUsed = true;
      const all = ladderTier(roomLadder(rows, draw), draw).sort((a, b) => Math.abs(Math.log(a.capacity / draw)) - Math.abs(Math.log(b.capacity / draw)));
      for (const x of list) {
        if (x.capacity) continue;
        const l = all.find((y) => roomNameMatches(y.name, x.name, place));
        if (l) x.capacity = { value: l.capacity, source: `https://www.wikidata.org/wiki/${l.qid}`, quote: `${l.name}; maximum capacity ${l.capacity} (Wikidata P1083)` };
      }
      const grade = (l: LadderRoom) => roomGrade({ id: l.qid, name: l.name, tags: [], capacity: { value: l.capacity, source: "", quote: "" } }, draw);
      const rungs = all
        .filter((l) => !list.some((x) => roomNameMatches(l.name, x.name, place)))
        .sort((a, b) => grade(a) - grade(b) || Number(concertRoom(b)) - Number(concertRoom(a)) || Math.abs(Math.log(a.capacity / draw)) - Math.abs(Math.log(b.capacity / draw)))
        .slice(0, 2);
      const added: Room[] = [];
      for (const l of rungs) {
        const r = await cachedStep<Room | null>(`${CACHE}/find/${sha(`${l.name}|${c.marketId}|${draw}`)}.json`, 2, () => findPlace(artist, l.name, c.marketId, draw).catch((e: Error) => Promise.reject(new StepFailed(`${l.name} in ${c.city}: ${e.message}`))));
        if (!r || list.some((x) => x.id === r.id)) continue;
        added.push({ ...r, origin: "wikidata", capacity: { value: l.capacity, source: `https://www.wikidata.org/wiki/${l.qid}`, quote: `${l.name}; maximum capacity ${l.capacity} (Wikidata P1083)` } });
      }
      if (added.length) {
        const ids = added.map((x) => x.id);
        const aff = new Map(await cachedStep<[string, number][]>(`${CACHE}/score/${sha([artist.id, ...ids].join("|"))}.json`, 1, async () => [...(await scoreRooms(artist, ids).catch((e: Error) => Promise.reject(new StepFailed(`scoreRooms: ${e.message}`))))]));
        for (const x of added) if (aff.has(x.id)) x.affinity = aff.get(x.id);
      }
      list.push(...added);
      check = roomCheck(list, want ?? first?.id, draw);
    }
    out.push({ marketId: c.marketId, rooms: list.map((r) => ({ ...r, measured: measured.has(r.id) || r.origin === "wikidata" })), choice: want, first: first?.id, booked: check.room?.id, bookable: check.bookable, status: check.status, ladderUsed });
  }
  return out;
}

/* ───────────────────────── stage: run ───────────────────────── */

async function run() {
  for (const v of subjects()) {
    const p = `${CACHE}/city/${slug(v.artist)}.json`;
    if (existsSync(p)) continue;
    try {
      const artist = await artistOf(v);
      if (!artist) {
        console.log(`${v.artist}: not found on Qloo; left out`);
        continue;
      }
      const states = await shipped(v, artist);
      writeJson(p, states);
    } catch (e) {
      if (e instanceof CapReached) {
        console.log(`stopping before finishing ${v.artist}: ${e.message}`);
        break;
      }
      if (e instanceof StepFailed) {
        console.log(`${v.artist}: a Qloo step failed (${e.message}); left for a rerun`);
        continue;
      }
      throw e;
    }
    console.log(`${v.artist.padEnd(32)} done | Qloo ${ledger().qloo}/${QLOO_CAP}`);
  }
  console.log(`ledger: ${JSON.stringify(ledger())}`);
}

/* ───────────────────────── stage: score ───────────────────────── */

function contrast(name: string, a: number[], b: number[]) {
  const d = a.map((x, i) => x - b[i]!);
  const st = signTest(d);
  const ci = meanCI(d, SEED);
  return { name, n: d.length, meanA: avg(a), meanB: avg(b), diff: ci.mean, lo: ci.lo, hi: ci.hi, wins: st.wins, losses: st.losses, ties: st.ties, p: st.p };
}

const ARMS = ["shipped", "shippedNoChoice", "popAffinity", "qloo", "popular", "ladder", "model"] as const;
type Arm = (typeof ARMS)[number];
const ARM_NAME: Record<Arm, string> = {
  shipped: "Routed's booked room (agent's names, Wikidata ladder, size rule)",
  shippedNoChoice: "The same, with no agent choice",
  popAffinity: "Qloo's rooms by popularity and fan affinity together",
  qloo: "Qloo, the artist's room ranking (round 2)",
  popular: "Qloo places by popularity, no artist (round 2)",
  ladder: "Biggest fitting room on Wikidata (round 2)",
  model: "The model alone (round 2)",
};

function ladderList(marketId: string, draw: number): string[] | null {
  if (!existsSync(`${O2}/venues/ladder/${marketId}.json`)) return null;
  const all = roomLadder(ladderRows(marketId), draw);
  const fitting = ladderTier(all, draw).sort((a, b) => b.capacity - a.capacity);
  const rest = all.filter((r) => !fitting.includes(r)).sort((a, b) => Math.abs(Math.log(a.capacity / draw)) - Math.abs(Math.log(b.capacity / draw)));
  return [...fitting, ...rest].map((r) => r.name);
}

function score() {
  const rows: any[] = [];
  const missing: { artist: string; reason: string }[] = [];
  for (const v of subjects()) {
    const p = `${CACHE}/city/${slug(v.artist)}.json`;
    const model = modelVenues(v.artist);
    if (!existsSync(p) || !model) {
      missing.push({ artist: v.artist, reason: existsSync(p) ? "no model answer" : "not run (cap reached, or no cached Qloo artist)" });
      continue;
    }
    const states = readJson<CityState[]>(p);
    const cities = v.cities.map((c) => {
      const st = states.find((s) => s.marketId === c.marketId)!;
      const real = c.venues.map((x) => x.names);
      const q = qlooList(v.artist, c.marketId)!;
      const pop = readJson<{ ok: boolean; rooms: { name: string }[] }>(`${O2}/venues/popular/${c.marketId}-${popTier(v.draw)}.json`);
      const order = (wanted?: string) => {
        const rs = st.rooms as Room[];
        return [...rs].sort((a, b) => roomGrade(a, v.draw) - roomGrade(b, v.draw) || Number(b.id === wanted) - Number(a.id === wanted) || rs.indexOf(a) - rs.indexOf(b));
      };
      const shippedOrder = order(st.choice ?? st.first);
      const noChoiceFirst = (st.rooms as Room[]).find((r) => !v.draw || v.draw < BIG_ROOM_DRAW || (sizePrior(r) !== "small" && roomNameOk(r.name, v.draw))) ?? st.rooms[0];
      const noChoiceOrder = order(noChoiceFirst?.id);
      const lists: Record<Arm, string[] | null> = {
        shipped: shippedOrder.map((r) => r.name),
        shippedNoChoice: noChoiceOrder.map((r) => r.name),
        popAffinity: popularityAffinityOrder(q).map((r) => r.name),
        qloo: q.map((r) => r.name),
        popular: pop.ok ? pop.rooms.map((r) => r.name) : null,
        ladder: ladderList(c.marketId, v.draw),
        model: (model.cities.find((x) => x.city_id === c.marketId)?.rooms ?? []).slice(0, 5),
      };
      const ranks = Object.fromEntries(ARMS.map((k) => [k, lists[k] ? rankOf(lists[k]!, real) : null])) as Record<Arm, number | null>;
      const booked = (st.rooms as (Room & { measured?: boolean })[]).find((r) => r.id === st.booked);
      // The booked room should be first in its own order (roomCheck books chooseRoom's first).
      if (booked && shippedOrder[0]!.id !== booked.id) throw new Error(`${v.artist} ${c.city}: booked room is not first in the shipped order`);
      return {
        marketId: c.marketId,
        city: c.city,
        real: c.venues.map((x) => x.names[0]),
        ranks,
        top: Object.fromEntries(ARMS.map((k) => [k, lists[k] ? lists[k]!.slice(0, 3) : null])),
        booked: booked
          ? {
              name: booked.name,
              from: booked.origin === "agent" ? "the agent's names, found on Qloo" : booked.origin === "wikidata" ? "the Wikidata ladder, found on Qloo" : "Qloo's list",
              agentsChoice: booked.id === st.choice,
              capacity: booked.capacity?.value ?? null,
              fit: booked.capacity ? (roomFit(booked, v.draw) ?? fit(booked, v.draw)) : "unmeasured",
            }
          : null,
        bookable: st.bookable,
        ladderUsed: st.ladderUsed,
        candidates: st.rooms.length,
        agentRoomsAdded: st.rooms.filter((r) => r.origin === "agent").length,
        ladderRoomsAdded: st.rooms.filter((r) => r.origin === "wikidata").length,
      };
    });
    const share = (k: Arm, n: number) => avg(cities.map((c) => (c.ranks[k] !== null && c.ranks[k]! <= n ? 1 : 0)));
    rows.push({ artist: v.artist, set: v.set, region: v.region, tour: v.tour, draw: v.draw, cities, hit1: Object.fromEntries(ARMS.map((k) => [k, share(k, 1)])), hit3: Object.fromEntries(ARMS.map((k) => [k, share(k, 3)])) });
  }
  const pair = (name: string, a: Arm, b: Arm, metric: "hit1" | "hit3") => {
    const xs = rows.filter((r) => r.cities.every((c: any) => c.top[a] !== null && c.top[b] !== null));
    return contrast(name, xs.map((r) => r[metric][a]), xs.map((r) => r[metric][b]));
  };
  const allCities = rows.flatMap((r) => r.cities);
  const pooled = Object.fromEntries(
    ARMS.map((k) => {
      const xs = allCities.filter((c: any) => c.top[k] !== null);
      return [k, { cities: xs.length, hit1: xs.filter((c: any) => c.ranks[k] === 1).length, hit3: xs.filter((c: any) => c.ranks[k] !== null && c.ranks[k] <= 3).length, listed: xs.filter((c: any) => c.ranks[k] !== null).length }];
    }),
  );
  const booked = allCities.map((c: any) => c.booked).filter(Boolean);
  const sources = {
    cities: allCities.length,
    booked: booked.length,
    fromQlooList: booked.filter((b: any) => b.from === "Qloo's list").length,
    fromAgentNames: booked.filter((b: any) => b.from.startsWith("the agent")).length,
    fromLadder: booked.filter((b: any) => b.from.startsWith("the Wikidata")).length,
    agentsChoice: booked.filter((b: any) => b.agentsChoice).length,
    measured: booked.filter((b: any) => b.capacity !== null).length,
    ladderRun: allCities.filter((c: any) => c.ladderUsed).length,
    notBookable: allCities.filter((c: any) => !c.bookable).length,
  };
  const l = ledger();
  const out = {
    scored: new Date().toISOString(),
    protocol: "data/outside2/PROTOCOL-4.md",
    script: "scripts/rooms4.ts",
    seed: SEED,
    usage: { qloo: l.qloo, qlooCap: QLOO_CAP, modelCalls: 0 },
    n: rows.length,
    cities: allCities.length,
    arms: ARM_NAME,
    primary: [pair("Routed's booked room vs the model alone, hit@1", "shipped", "model", "hit1"), pair("Routed's room order vs the model alone, hit@3", "shipped", "model", "hit3"), pair("Qloo by popularity and affinity vs Qloo by affinity, hit@3", "popAffinity", "qloo", "hit3")],
    secondary: [
      pair("Routed's room order vs Qloo's list, hit@3", "shipped", "qloo", "hit3"),
      pair("Routed's booked room vs Qloo's first room, hit@1", "shipped", "qloo", "hit1"),
      pair("Routed's booked room with no agent choice vs the model alone, hit@1", "shippedNoChoice", "model", "hit1"),
      pair("Routed's booked room vs the biggest fitting Wikidata room, hit@1", "shipped", "ladder", "hit1"),
      pair("Qloo by popularity and affinity vs Qloo popularity only, hit@3", "popAffinity", "popular", "hit3"),
      pair("Qloo by popularity and affinity vs the model alone, hit@3", "popAffinity", "model", "hit3"),
    ],
    pooled,
    sources,
    rows,
    missing,
  };
  writeJson(OUT, out);
  const f = (c: ReturnType<typeof contrast>) => `${c.name.padEnd(72)} n=${c.n} ${(100 * c.meanA).toFixed(1)}% vs ${(100 * c.meanB).toFixed(1)}%  ${(100 * c.diff).toFixed(1)} [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]  ${c.wins}-${c.losses}-${c.ties}  p=${c.p.toFixed(3)}`;
  for (const c of [...out.primary, ...out.secondary]) console.log(f(c));
  console.log(JSON.stringify(pooled));
  console.log(JSON.stringify(sources), `missing ${missing.length}`, JSON.stringify(out.usage));
}

/** Round 2's popularity-only cache key: the crowd tier's upper bound (scripts/outside2.ts). */
const popTier = (draw: number) => venueTier(draw).max;

const stage = process.argv[2];
if (stage === "run") await run();
else if (stage === "score") score();
else console.log("stages: run | score");
