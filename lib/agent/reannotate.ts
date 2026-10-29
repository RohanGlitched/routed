import { marketById } from "../geo/markets";
import { HOME_RANK, MAX_LEG_KM, homeCity, longLegs, orderStops, radiusFor, schedule, tooClose, addDays } from "../geo/route";
import { placeHeat, readLocal } from "../geo/local";
import type { CityScore, LogLine, Plan, Room, Stop, TourRecord } from "../types";
import { capacityOverride } from "./capacity";
import { checkWhy, fit, room as bookedRoom, strongSource, whyProblems } from "./evidence";
import { FAN_KEEP } from "./plan";
import { qlooDiff } from "./qloodiff";
import { chooseRoom, civicOrCampus, pickSupport, roomCheck, roomNameOk, twoNights } from "./rooms";

/**
 * Re-annotates a stored tour under the rules as they read now (Oct 30, after the Oct 29 judging round), with no
 * Qloo and no model call: hand-checked capacities, the room rule on them, the support act's size rule, place
 * kinds, OpenStreetMap neighbourhoods passed in by the caller, and each stop's reason. With `route`, the stops may
 * change too: a stop that breaks a published rule (a leg over the cap, a hometown left off) or costs a detour gives
 * way to a city this artist was scouted in on an earlier run (`donors`: same artist, crowd and region), which keeps
 * that run's rooms and Qloo lookups. Every change is a call-sheet line saying what moved and why. Pitches are left
 * for the caller to re-draft (`stale`), since dates, rooms and the support act may have moved.
 */

export type Donor = { stop: Stop; tour: string; createdAt: string };
export type RouteMode = "keep" | "rules" | "detour";
export type Reannotated = { rec: TourRecord; changes: string[]; stale: boolean };

const popOf = (id: string) => marketById(id)?.pop ?? 0;
const pt = (s: { lat: number; lon: number; marketId: string }) => ({ lat: s.lat, lon: s.lon, pop: popOf(s.marketId), id: s.marketId });
const n0 = (v: number) => v.toLocaleString("en-US");

/** A place Qloo files under a kind its name contradicts (Sun Studio, a "record store"; Seattle Antiques Market). */
export function placeKind(name: string, kind?: string): string | undefined {
  if (!kind) return kind;
  if (/\bstudios?\b/i.test(name) && kind === "Record store") return "Studio and museum";
  if (/\bantiques?\b|\bmarket\b|\bmall\b/i.test(name) && kind === "Record store") return "Market";
  if (/\bmuseum\b|\bhall of fame\b/i.test(name) && kind !== "Café") return "Museum";
  return kind;
}

/** What a route costs against the rules: legs over the cap, the hometown missing, top fan cities missing, radius
 *  clashes (a hometown carve-out excepted), then road km and the stops' fan ranks. Lower is better, compared in order. */
function costOf(plan: Plan, stops: Stop[], home: string | undefined, keep: string[], carve?: string) {
  const ordered = orderStops(plan.from, stops.map(pt), { max: MAX_LEG_KM, first: home && stops.some((s) => s.marketId === home) ? home : undefined });
  const legs = longLegs(plan.from, ordered).length;
  const r = radiusFor(plan.region);
  let clash = 0;
  for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < stops.length; j++) if (tooClose(pt(stops[i]!), pt(stops[j]!), r) && stops[i]!.marketId !== carve && stops[j]!.marketId !== carve) clash++;
  const km = schedule(plan.from, ordered, plan.firstDate).reduce((t, l) => t + l.fromKm, 0);
  return { legs, home: home && !stops.some((s) => s.marketId === home) ? 1 : 0, keep: keep.filter((k) => !stops.some((s) => s.marketId === k)).length, clash, km, rank: stops.reduce((t, s) => t + s.score.rank, 0) };
}
type Cost = ReturnType<typeof costOf>;
const rulesBetter = (a: Cost, b: Cost) => {
  const va = [a.legs, a.home, a.clash], vb = [b.legs, b.home, b.clash];
  for (let i = 0; i < va.length; i++) if (vb[i]! !== va[i]!) return vb[i]! < va[i]!;
  return false;
};
/** A detour fix: the same rules, at least 15% less road, the fan ranks no more than 30% weaker, top fan cities kept. */
const detourBetter = (a: Cost, b: Cost) => b.legs <= a.legs && b.home <= a.home && b.clash <= a.clash && b.keep <= a.keep && b.km <= a.km * 0.85 && b.rank <= a.rank * 1.3;

export function reannotate(rec: TourRecord, o: { route?: RouteMode; donors?: Donor[]; osm?: Map<string, string | { name: string; km?: number }>; at?: string; carveHome?: boolean } = {}): Reannotated {
  if (!rec.plan?.stops?.length) return { rec, changes: [], stale: false };
  const at = o.at ?? new Date().toISOString();
  const plan = structuredClone(rec.plan);
  const draw = rec.input.draw ?? plan.assumedDraw;
  const changes: string[] = [];
  const lines: LogLine[] = [];
  const say = (text: string, result?: string) => lines.push({ at, kind: "rule", text, ...(result ? { result } : {}) });
  const cityOf = new Map(plan.cities.map((c) => [c.marketId, c]));

  // 1. Capacities checked by hand win over listings, on every room of every stop (and on a donor's rooms).
  const recap = (s: Stop, label: string) => {
    const out: string[] = [];
    for (const r of s.rooms) {
      const fixed = capacityOverride(r.name, label);
      if (!fixed || (r.capacity?.value === fixed.value && r.capacity.source === fixed.source)) continue;
      if (r.capacity?.value !== fixed.value) out.push(`${r.name} ${r.capacity ? `${n0(r.capacity.value)} → ` : ""}${n0(fixed.value)}`);
      r.capacity = fixed;
    }
    return out;
  };
  const capped = plan.stops.flatMap((s) => recap(s, s.label));
  if (capped.length) {
    changes.push(`capacities: ${capped.join(", ")}`);
    say("Room capacities checked by hand against Wikipedia, the venue, its operator or the trade press now replace the ticket-resale and event-hire listings they came from.", capped.join("; "));
  }

  // 2. The room rule on the corrected capacities.
  const reRoom = (s: Stop): string | null => {
    const was = bookedRoom(s);
    // A move only to a room whose capacity can be trusted without checking (Komedia's 2,124 in Bristol is a listing
    // site's guess); the booked room stays a candidate whatever its source.
    // A free park stage or a campus arena opens the whole city's list (rooms by name, measured or not).
    const cur = bookedRoom(s);
    const pool = cur && civicOrCampus(cur) ? s.rooms.filter((x) => roomNameOk(x.name, draw) && !civicOrCampus(x)) : s.rooms.filter((x) => x.id === s.roomId || strongSource(x.capacity));
    const next = chooseRoom(pool.length ? pool : s.rooms, s.roomId, draw);
    if (!next) return null;
    const nights = twoNights(next, draw) && !s.rooms.some((x) => fit(x, draw) === "fits") ? 2 : 1;
    const moved = next.id !== s.roomId || nights !== (s.nights ?? 1);
    s.roomId = next.id;
    if (nights > 1) s.nights = nights;
    else delete s.nights;
    if (!moved) return null;
    return next.id === was?.id ? `${s.city}: ${next.name}, ${nights > 1 ? "two nights" : "one night"} at ${n0(next.capacity?.value ?? 0)}` : `${s.city}: ${was?.name ?? "the room"} → ${next.name}${nights > 1 ? ", two nights" : ""}`;
  };
  const roomed = plan.stops.map(reRoom).filter((x): x is string => Boolean(x));
  if (roomed.length) {
    changes.push(`rooms: ${roomed.join("; ")}`);
    say("With the checked capacities, the room rule (a close fit, then one the fans sell out, then a loose fit) books again where its answer changed.", roomed.join("; "));
  }

  // 3. The route. Hometown and top fan cities as the live rules define them.
  const ranked = plan.cities.map((c) => ({ ...c, id: c.marketId, pop: popOf(c.marketId) }));
  const home = homeCity(plan.from, ranked, HOME_RANK)?.id;
  const keep = [...plan.cities].sort((a, b) => a.rank - b.rank).slice(0, FAN_KEEP).map((c) => c.marketId);
  const carve = o.carveHome ? home : undefined;
  if (o.route && o.route !== "keep") {
    const pool = (o.donors ?? [])
      .filter((d) => cityOf.has(d.stop.marketId) && !plan.stops.some((s) => s.marketId === d.stop.marketId))
      .map((d) => {
        const s = structuredClone(d.stop);
        s.score = cityOf.get(s.marketId)!;
        recap(s, s.label);
        reRoom(s);
        delete s.pitch;
        return { s, d };
      })
      .filter(({ s }) => roomCheck(s.rooms, s.roomId, draw).bookable && Boolean(bookedRoom(s)?.capacity));
    for (let pass = 0; pass < 2; pass++) {
      const now = costOf(plan, plan.stops, home, keep, carve);
      let best: { cost: Cost; i: number; c: (typeof pool)[number] } | null = null;
      for (let i = 0; i < plan.stops.length; i++) {
        const out = plan.stops[i]!;
        if (out.marketId === home) continue;
        for (const c of pool) {
          if (plan.stops.some((s) => s.marketId === c.s.marketId)) continue;
          const trial = plan.stops.map((s, j) => (j === i ? c.s : s));
          const cost = costOf(plan, trial, home, keep, carve);
          const ok = rulesBetter(now, cost) || (o.route === "detour" && detourBetter(now, cost));
          if (!ok) continue;
          if (!best || rulesBetter(best.cost, cost) || (!rulesBetter(cost, best.cost) && cost.km + 40 * cost.rank < best.cost.km + 40 * best.cost.rank)) best = { cost, i, c };
        }
      }
      if (!best) break;
      const out = plan.stops[best.i]!;
      const into = best.c.s;
      plan.stops[best.i] = into;
      const why = best.cost.legs < now.legs ? `${out.city} cost a leg over ${n0(MAX_LEG_KM)} km` : best.cost.home < now.home ? `the run starts in ${into.city}, #${into.score.rank} on the fan map, and no band routes past its hometown` : `${out.city} (#${out.score.rank}) was a ${n0(Math.round(now.km - best.cost.km))} km detour`;
      changes.push(`route: ${out.city} → ${into.city}`);
      say(`${why}, so ${into.city} (#${into.score.rank} on the fan map) takes its place, with the rooms and Qloo lookups from Routed's ${best.c.d.createdAt.slice(0, 10)} run for this artist (tour ${best.c.d.tour}); no new Qloo call.`, `${n0(now.km)} km of road before, ${n0(best.cost.km)} after`);
    }
  }

  // Order and dates, always: the shortest drive under the leg cap, the hometown first.
  const firstId = home && plan.stops.some((s) => s.marketId === home) ? home : undefined;
  const ordered = orderStops(plan.from, plan.stops.map((s) => ({ ...s, id: s.marketId })), { max: MAX_LEG_KM, first: firstId });
  const legs = schedule(plan.from, ordered, plan.firstDate);
  const before = plan.stops.map((s) => `${s.city} ${s.date}`).join(", ");
  plan.stops = legs.map((l) => {
    const { id: _id, ...s } = l.stop as Stop & { id: string };
    const next: Stop = { ...s, date: l.date, fromKm: l.fromKm, fromHours: l.fromHours, travelDays: l.travelDays, dayOff: l.dayOff };
    if (l.ferry) next.ferry = l.ferry;
    else delete next.ferry;
    if (l.nights > 1) next.nights = l.nights;
    else delete next.nights;
    return next;
  });
  plan.totalKm = legs.reduce((t, l) => t + l.fromKm, 0);
  plan.lastDate = legs.length ? addDays(legs.at(-1)!.date, legs.at(-1)!.nights - 1) : plan.firstDate;
  const after = plan.stops.map((s) => `${s.city} ${s.date}`).join(", ");
  if (after !== before) {
    changes.push("dates");
    say("Routed again in the shortest drive under the leg cap and put back on the calendar.", `${plan.stops.length} cities, ${plan.firstDate} to ${plan.lastDate}, about ${n0(plan.totalKm)} km of road; ${plan.stops.filter((s) => s.travelDays > 0).length} legs with travel days`);
  }
  if (carve && plan.stops.some((s) => s.marketId === carve)) {
    const h = plan.stops.find((s) => s.marketId === carve)!;
    const near = plan.stops.filter((s) => s !== h && tooClose(pt(s), pt(h), radiusFor(plan.region)));
    if (near.length) say(`${h.city} is the hometown show, inside the ${radiusFor(plan.region)} km radius of ${near.map((x) => x.city).join(" and ")}: a carve-out the ${near.map((x) => x.city).join(" and ")} buyer has to agree to, and the hold request says so.`);
  }

  // 4. One support act, well below the headliner.
  const was = plan.stops[0]?.openers.find((x) => x.id === plan.stops[0]!.openerId);
  const support = pickSupport(plan.stops.map((s) => ({ openers: s.openers, openerId: s.openerId })), plan.artist.popularity);
  if (support) {
    for (const s of plan.stops) {
      if (!s.openers.some((x) => x.id === support.id)) s.openers = [support, ...s.openers];
      s.openerId = support.id;
    }
    if (was && was.id !== support.id) {
      changes.push(`support: ${was.name} → ${support.name}`);
      say(`${was.name} is nearly as big as ${plan.artist.name} on Qloo, a co-headliner priced like one, so the support slot goes to ${support.name}, from the artists Qloo already suggested in these cities.`, "A support act sits well below the headliner on Qloo's popularity");
    }
  }

  // 5. Place kinds a name contradicts.
  const kinds: string[] = [];
  for (const s of plan.stops) for (const p of [...(s.posters ?? []), ...s.after]) {
    const k = placeKind(p.name, p.kind);
    if (k !== p.kind) {
      kinds.push(`${p.name} (${p.kind} → ${k})`);
      p.kind = k;
    }
  }
  if (kinds.length) changes.push(`kinds: ${kinds.join(", ")}`);

  // 6. OpenStreetMap's neighbourhood where Qloo's places name none.
  const named: string[] = [];
  for (const s of plan.stops) {
    if (!s.local?.hot || s.local.hot.name) continue;
    const got = o.osm?.get(s.marketId);
    if (!got) continue;
    const { name, km } = typeof got === "string" ? { name: got, km: undefined } : got;
    s.local.hot = { ...s.local.hot, name, named: "osm", ...(km ? { osmKm: km } : {}) };
    named.push(`${s.city}: ${name}${km ? ` (nearest, about ${km} km)` : ""}`);
  }
  if (named.length) {
    changes.push(`neighbourhoods: ${named.join(", ")}`);
    say("Qloo's places named no neighbourhood for the hottest blocks in these cities, so the one OpenStreetMap puts the hottest tile in is named instead (© OpenStreetMap contributors).", named.join("; "));
  }
  // The room against the hottest blocks, for a stop whose room moved.
  for (const s of plan.stops) {
    const r = bookedRoom(s);
    if (!s.local?.hot || !r || r.lat === undefined || r.lon === undefined || !Array.isArray(s.local.tiles)) continue;
    const h = placeHeat(s.local.tiles, { lat: r.lat, lon: r.lon });
    if (h) {
      s.local.roomKm = h.km;
      s.local.inHot = h.inHot;
    }
    void readLocal;
  }

  // 7. Each stop's reason: the model's sentence where it still describes the stop and passes every check, else the rule's.
  const whys: string[] = [];
  for (const s of plan.stops) {
    const old = s.why;
    const gone = s.openers.filter((x) => x.id !== s.openerId).some((x) => old?.includes(x.name));
    const stale = !old || gone || whyProblems(plan, s, draw).length > 0 || Boolean(bookedRoom(s) && !old.includes(bookedRoom(s)!.name));
    s.why = checkWhy(plan, { ...s, why: old ?? "x" }, draw, { keepModel: !stale });
    if (s.why !== old) whys.push(s.city);
  }
  if (whys.length) {
    changes.push(`reasons: ${whys.join(", ")}`);
    say("Each stop's reason re-checked: a room is said to fit only at 85-130% of the crowd, a room the fans sell out names the next step, and no line keeps a prompt's field names or a figure the evidence doesn't hold.", `${whys.length} of ${plan.stops.length} reasons rewritten from the rule: ${whys.join(", ")}`);
  }

  // 8. What depends on the cities: Stops Qloo changed, and the comparison with the model alone.
  if (plan.qlooDiff) plan.qlooDiff = { ...qlooDiff(plan.stops.map((s) => ({ marketId: s.marketId, name: s.city })), plan.qlooDiff.population, plan.cities, plan.region), population: plan.qlooDiff.population };
  if (plan.guess) {
    const ids = new Set(plan.stops.map((s) => s.marketId));
    const rooms = new Set(plan.stops.map((s) => s.roomId));
    const aff = Object.fromEntries(Object.entries(plan.guess.routedRoomAffinity).filter(([k]) => rooms.has(k)));
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
    plan.guess = {
      ...plan.guess,
      rankMean: { ...plan.guess.rankMean, routed: mean(plan.stops.map((s) => s.score.rank)) },
      cityMean: { ...plan.guess.cityMean, routed: mean(plan.stops.map((s) => s.score.affinity)) },
      roomMean: { ...plan.guess.roomMean, routed: mean(Object.values(aff)) },
      routedRoomAffinity: aff,
      shared: plan.guess.stops.filter((g) => g.marketId && ids.has(g.marketId)).length,
    };
  }
  if (plan.tradeOff && plan.cities.length && changes.some((c) => c.startsWith("route:"))) delete plan.tradeOff;

  const stale = changes.some((c) => /^(route|dates|support|rooms|capacities)/.test(c));
  if (!changes.length) return { rec, changes, stale: false };
  lines.unshift({ at, kind: "rule", text: "Oct 30: this stored tour was re-checked against the rules as they read now, from what the run already stored: no new Qloo or model call for any of the changes below." });
  return { rec: { ...rec, plan, log: [...rec.log, ...lines] }, changes, stale };
}

export type { CityScore, Room };
