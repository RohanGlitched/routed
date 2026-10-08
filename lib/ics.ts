import type { Plan } from "./types";

/**
 * The tour as a calendar file (RFC 5545): one all-day event per show with the room, the opener, the drive and
 * the fan-map rank in the notes, plus the travel days and days off between them, so a tour manager drops the
 * routing straight into the band's shared calendar. Pure, so it is tested and runs in the browser.
 */

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const day = (iso: string) => iso.replace(/-/g, "");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Lines longer than 75 octets are folded with a CRLF and a space, as the standard asks. */
function fold(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > 73) {
      out.push(cur);
      cur = ` ${ch}`;
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function tourCalendar(plan: Plan, tourId: string, siteUrl: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const name = `${plan.artist.name} tour`;
  const events: string[][] = [];
  plan.stops.forEach((s, i) => {
    const room = s.rooms.find((r) => r.id === s.roomId) ?? s.rooms[0];
    const opener = s.openers.find((o) => o.id === s.openerId) ?? s.openers[0];
    const prev = i === 0 ? plan.from.label : plan.stops[i - 1]!.label;
    const notes = [
      `Fan city #${s.score.rank} of ${plan.cities.length} on ${plan.artist.name}'s Qloo heatmap.`,
      room ? `Room: ${room.name}${room.capacity ? ` (holds ${room.capacity.value.toLocaleString("en-US")})` : ""}.` : "",
      opener ? `Opener: ${opener.name}.` : "",
      `${s.fromKm.toLocaleString("en-US")} km from ${prev}, about ${s.fromHours} h.`,
      `Tour book: ${siteUrl}/tour/${tourId}`,
    ].filter(Boolean);
    // Days with no show before this one: travel, or the day off.
    if (i > 0 && s.travelDays > 0) {
      for (let k = s.travelDays; k >= 1; k--) {
        const d = addDays(s.date, -k);
        const off = s.dayOff && k === 1;
        events.push([`UID:${tourId}-${d}-${off ? "off" : "travel"}@routed`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(d)}`, `DTEND;VALUE=DATE:${day(addDays(d, 1))}`, `SUMMARY:${esc(off ? `Day off (${name})` : `Travel day: ${prev.split(",")[0]} to ${s.city} (${name})`)}`, "TRANSP:TRANSPARENT"]);
      }
    }
    events.push([
      `UID:${tourId}-${s.date}@routed`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(s.date)}`,
      `DTEND;VALUE=DATE:${day(addDays(s.date, 1))}`,
      `SUMMARY:${esc(`${plan.artist.name}: ${s.city}${room ? ` at ${room.name}` : ""}`)}`,
      `LOCATION:${esc(room ? `${room.name}${room.address ? `, ${room.address}` : ""}` : s.label)}`,
      `DESCRIPTION:${esc(notes.join("\n"))}`,
      `URL:${siteUrl}/tour/${tourId}`,
    ]);
  });
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Routed//Tour book//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]),
    "END:VCALENDAR",
  ];
  return lines.flatMap(fold).join("\r\n") + "\r\n";
}
