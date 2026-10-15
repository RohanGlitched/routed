import "server-only";
import { addDays, schedule } from "../geo/route";
import { placeHeat } from "../geo/local";
import { describeRequest, qlooGet } from "../qloo";
import { newUsage, withUsage } from "../usage";
import { roomCapacity } from "../web";
import type { LogLine, Room, TourRecord, Usage } from "../types";
import { checkNumbers, evidenceLines, fit } from "./evidence";
import { writePitches } from "./pitch";
import { candidatesBySize, chooseRoom, orchestraHallFor, reducedHouse, roomNameOk, twoNights } from "./rooms";

/**
 * Re-sizes a stored tour under the current room rules, without asking Qloo for anything new (Playbook N5: re-score
 * stored runs after a fix). Every stop keeps its city, its route and the rooms Qloo returned; the rooms are
 * measured again (Wikidata, then the web), filtered by the name rules (no pub for 1,000, no orchestra's own hall
 * for a rock act), and the room and the nights are chosen again. The calendar is re-dated for two-night stands,
 * the room is measured against the fans' neighbourhood again, and pitches are re-written only when a room or a
 * night count changed. The one Qloo call is the room-affinity score for any newly booked room, so the comparison
 * with the model alone stays on one scale. What changed is appended to the call sheet.
 */
export async function resizeTour(rec: TourRecord): Promise<{ rec: TourRecord; changed: string[] }> {
  const usage: Usage = newUsage();
  return withUsage(usage, async () => {
    const plan = structuredClone(rec.plan!);
    const draw = rec.input.draw;
    const genres = plan.artist.genreKeys ?? plan.artist.genres;
    const at = () => new Date().toISOString();
    const log: LogLine[] = [];
    const changed: string[] = [];

    await Promise.all(
      plan.stops.map(async (s) => {
        const ok = (r: Room) => roomNameOk(r.name, draw) && !orchestraHallFor(r.name, genres);
        const pool = s.rooms.filter(ok);
        if (!pool.length) return;
        // Every room is measured again from the shared index (one number per room, from the current reader), and
        // a stored number the index no longer backs is dropped.
        const measure = async (r: Room) => {
          if (measured.has(r)) return;
          measured.add(r);
          const cap = await roomCapacity(r, s.label).catch(() => null);
          if (cap) r.capacity = cap;
          else delete r.capacity;
        };
        const measured = new Set<Room>();
        for (const r of s.rooms) if (!measured.has(r)) delete r.capacity;
        const current = pool.find((r) => r.id === s.roomId);
        if (current) await measure(current);
        if (draw && !(current && fit(current, draw) === "fits")) {
          for (const r of candidatesBySize(pool.filter((x) => x !== current), draw).slice(0, 9)) {
            await measure(r);
            if (fit(r, draw) === "fits") break;
          }
        }
        const room = chooseRoom(pool, current?.id, draw);
        if (!room) return;
        const nights = twoNights(room, draw) && !pool.some((x) => fit(x, draw) === "fits") ? 2 : 1;
        const was = s.rooms.find((r) => r.id === s.roomId);
        if (room.id !== s.roomId) {
          const why = !was ? "wasn't a room" : !ok(was) ? "isn't the kind of room for this act and crowd" : was.capacity ? `holds ${was.capacity.value.toLocaleString("en-US")}, ${fit(was, draw)} for a crowd of about ${draw?.toLocaleString("en-US")}` : "couldn't be confirmed for the crowd";
          log.push({ at: at(), kind: "rule", text: `Re-sized under the Oct 15 room rules: ${was?.name ?? "the room"} ${why}, so ${s.city} gets ${room.name}.`, result: room.capacity ? `${room.name} holds ${room.capacity.value.toLocaleString("en-US")}${nights === 2 ? ": two nights" : reducedHouse(room, draw) ? ", in a reduced configuration" : ""}` : `${room.name}: capacity not found, ask the room` });
          s.roomId = room.id;
          s.why = `${s.city} is ${plan.artist.name}'s #${s.score.rank} city on Qloo${room.capacity ? `, and ${room.name} holds ${room.capacity.value.toLocaleString("en-US")}${nights === 2 ? " a night over two nights" : ""}` : `, and ${room.name} matches these fans at ${Math.round((room.affinity ?? 0) * 100)}`}.`;
          changed.push(s.city);
        }
        if ((s.nights ?? 1) !== nights) {
          if (room.id === was?.id) log.push({ at: at(), kind: "rule", text: `Re-sized under the Oct 15 room rules: ${room.name} holds ${room.capacity!.value.toLocaleString("en-US")}, under the usual crowd of about ${draw!.toLocaleString("en-US")}, and nothing in ${s.city} was confirmed to fit, so it's two nights.`, result: `${(room.capacity!.value * 2).toLocaleString("en-US")} across both nights` });
          if (nights > 1) s.nights = nights;
          else delete s.nights;
          if (!changed.includes(s.city)) changed.push(s.city);
        }
        if (s.local && room.lat !== undefined && room.lon !== undefined) {
          const h = placeHeat(s.local.tiles, { lat: room.lat, lon: room.lon });
          if (h) {
            s.local.roomKm = h.km;
            s.local.inHot = h.inHot;
          }
        }
      }),
    );

    if (changed.length) {
      // The calendar again: a two-night stand takes two dates.
      const legs = schedule(plan.from, plan.stops.map((s) => ({ ...s, lat: s.lat, lon: s.lon })), plan.firstDate);
      legs.forEach((l, i) => {
        const s = plan.stops[i]!;
        s.date = l.date;
        s.travelDays = l.travelDays;
        s.dayOff = l.dayOff;
      });
      plan.lastDate = addDays(legs.at(-1)!.date, legs.at(-1)!.nights - 1);
      for (const s of plan.stops) if (s.why) s.why = checkNumbers(s.why, evidenceLines(plan, s, draw)).text;

      // Score any newly booked room in one Qloo call, so both tours' rooms stay on one scale.
      const g = plan.guess;
      if (g) {
        const booked = plan.stops.map((s) => s.rooms.find((r) => r.id === s.roomId)).filter((r): r is Room => Boolean(r));
        const missing = booked.filter((r) => g.routedRoomAffinity[r.id] === undefined).map((r) => r.id);
        const ids = [...new Set([...missing, ...g.stops.map((x) => x.venueId).filter((x): x is string => Boolean(x))])];
        if (missing.length) {
          try {
            const { body, request } = await qlooGet<{ results?: { entities?: { entity_id: string; query?: { affinity?: number } }[] } }>("/v2/insights", { "filter.type": "urn:entity:place", "signal.interests.entities": plan.artist.id, "filter.results.entities": ids.join(","), take: Math.min(50, ids.length) });
            for (const e of body.results?.entities ?? []) if (typeof e.query?.affinity === "number" && missing.includes(e.entity_id)) g.routedRoomAffinity[e.entity_id] = e.query.affinity;
            log.push({ at: at(), kind: "qloo", text: `How strongly do ${plan.artist.name} fans match the newly booked rooms?`, result: `${missing.length} room${missing.length === 1 ? "" : "s"} scored with the model-alone tour's rooms`, request: describeRequest(request) });
          } catch {
            /* the comparison keeps the rooms it had scores for */
          }
        }
        const vals = booked.map((r) => g.routedRoomAffinity[r.id]).filter((v): v is number => typeof v === "number");
        if (vals.length) g.roomMean.routed = vals.reduce((a, b) => a + b, 0) / vals.length;
      }

      // Pitches written for the old rooms no longer describe the stop.
      const pitched = await writePitches(plan, true, draw);
      plan.stops.forEach((s, i) => (s.pitch = pitched.pitches[i]));
      log.push({ at: at(), kind: pitched.model ? "model" : "rule", text: `Re-drafted ${plan.stops.length} hold requests for the re-sized rooms.`, result: `${pitched.pitches.reduce((n, p) => n + p.struck.length, 0)} figures struck` });
    } else {
      log.push({ at: at(), kind: "rule", text: "Re-sized under the Oct 15 room rules: every room already met them.", result: "No change" });
    }

    const prior = rec.engine?.usage;
    const engine = rec.engine ? { ...rec.engine, usage: prior ? { qloo: prior.qloo + usage.qloo, qlooCached: prior.qlooCached + usage.qlooCached, modelCalls: prior.modelCalls + usage.modelCalls, tokensIn: prior.tokensIn + usage.tokensIn, tokensOut: prior.tokensOut + usage.tokensOut } : prior } : rec.engine;
    return { rec: { ...rec, plan, engine, log: [...rec.log, ...log] }, changed };
  });
}
