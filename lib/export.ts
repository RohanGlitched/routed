import type { Plan, Stop } from "./types";
import { fullDate, radiusLine, room, showNights } from "./agent/evidence";
import { fillDates, type FillLeg } from "./geo/fill";
import { fillOption, shownCapacity } from "../components/tour/display";

/**
 * The tour book for Monday morning, as a booker uses it: the routing grid as a spreadsheet (one row a show, the
 * columns an agent fills a routing sheet with) and every stop's hold request in one paste. Pure: built from the
 * stored plan only, in the tour book's own words (lib/agent/evidence.ts, lib/geo/fill.ts), so nothing is typed.
 */

export const GRID_COLUMNS = [
  "Date",
  "City",
  "Venue",
  "Capacity",
  "Capacity source",
  "Fit (% of the usual crowd)",
  "Hold ask",
  "Radius",
  "Km from the last show",
  "Hours from the last show",
  "Travel days before",
  "Fill-date options before this show",
] as const;

/** One CSV field: quoted when it holds a comma, a quote or a line break, its quotes doubled (RFC 4180). */
export function csvField(v: string | number | undefined): string {
  const s = v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** "1st hold on both dates (2 nights), 2nd if taken" */
export function holdAsk(s: Pick<Stop, "nights">): string {
  const n = Math.max(1, s.nights ?? 1);
  return n > 1 ? `1st hold on both dates (${n} nights), 2nd if taken` : "1st hold on the date (1 night), 2nd if taken";
}

/** The fill-date options for the dark days before a stop: "Tulsa (fan #61, adds 24 km, 5/11); Boise (…)". */
function fillCell(leg: FillLeg | undefined): string {
  if (!leg?.options.length) return "";
  return leg.options.map((o) => { const x = fillOption(o); return `${x.city} (${x.note})`; }).join("; ");
}

/** The grid as rows of plain values, header first (the tests read these; the CSV is these joined). */
export function routingRows(plan: Plan, draw?: number): string[][] {
  const fills = plan.cities?.length ? fillDates(plan.stops, plan.cities, plan.region) : [];
  const rows: string[][] = [[...GRID_COLUMNS]];
  plan.stops.forEach((s, i) => {
    const r = room(s);
    const cap = r ? shownCapacity(r) : undefined;
    rows.push([
      showNights(s).join(" and "),
      s.label,
      r?.name ?? "",
      cap ? String(cap.value) : "",
      cap?.source ?? (r ? "Not found on the web; ask the room" : ""),
      cap && draw ? String(Math.round((cap.value / draw) * 100)) : "",
      holdAsk(s),
      (radiusLine(plan, s) ?? "").replace(/^Radius: /, ""),
      i === 0 ? "" : String(s.fromKm),
      i === 0 ? "" : String(s.fromHours),
      i === 0 ? "" : String(s.travelDays),
      fillCell(fills.find((f) => f.index === i)),
    ]);
  });
  return rows;
}

/** The routing grid as a CSV file's text: a byte-order mark so a spreadsheet reads it as UTF-8, CRLF line ends. */
export function routingCsv(plan: Plan, draw?: number): string {
  return `﻿${routingRows(plan, draw).map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

const unstrike = (t: string) => t.replace(/~~[^~]+~~/g, "").replace(/[ \t]{2,}/g, " ");

/** The separator between two hold requests in "Copy all holds". */
export const HOLD_SEPARATOR = "\n\n----------------------------------------\n\n";

/** Every stop's hold request, subject and body, struck figures left out, in tour order; stops without one are noted. */
export function allHolds(plan: Plan): string {
  const n = plan.stops.length;
  return plan.stops
    .map((s, i) => {
      const head = `Stop ${i + 1} of ${n}: ${s.label}, ${fullDate(s.date)}`;
      if (!s.pitch) return `${head}\n(No hold request drafted for this stop.)`;
      return `${head}\nSubject: ${unstrike(s.pitch.subject).trim()}\n\n${unstrike(s.pitch.body).trim()}`;
    })
    .join(HOLD_SEPARATOR);
}

/** "sierra-ferrell-routing-grid.csv" */
export const exportName = (artist: string, what: string) => `${artist.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-${what}`;
