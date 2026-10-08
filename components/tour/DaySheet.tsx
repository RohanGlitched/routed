"use client";

import { useState } from "react";
import { fit } from "@/lib/agent/evidence";
import { independents } from "@/lib/chains";
import type { Spot, Stop } from "@/lib/types";
import { LocalMap } from "./LocalMap";
import s from "./tour.module.css";

const pct = (v?: number) => (v === undefined ? null : Math.round(v * 100));
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** Struck figures (not in the evidence) come back wrapped in ~~ ~~; show them struck, not hidden. */
function Checked({ text }: { text: string }) {
  const parts = text.split(/(~~[^~]+~~)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("~~") ? (
          <del key={i} title="Not in the evidence, so struck">
            {p.slice(2, -2)}
          </del>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** One stop, laid out like a tour manager's day sheet. */
export function DaySheet({ stop, prev, total, artist, pending, draw }: { stop: Stop; prev: string; total: number; artist: string; pending: boolean; draw?: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const d = new Date(`${stop.date}T12:00:00Z`);
  const room = stop.rooms.find((r) => r.id === stop.roomId) ?? stop.rooms[0];
  const others = stop.rooms.filter((r) => r !== room).slice(0, 2);
  const opener = stop.openers.find((o) => o.id === stop.openerId) ?? stop.openers[0];
  const pitch = stop.pitch;

  return (
    <li className={s.day}>
      <div className={s.when}>
        <span className={s.dow}>{d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}</span>
        <time dateTime={stop.date} className={s.date}>
          {d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} {d.getUTCDate()}
        </time>
        <span className={s.drive}>
          {stop.dayOff ? "Day off before. " : stop.travelDays ? `${stop.travelDays} travel day${stop.travelDays > 1 ? "s" : ""} before. ` : ""}
          <span className="num">{stop.fromKm.toLocaleString("en-US")}</span> km from {prev}, about <span className="num">{stop.fromHours}</span> h
        </span>
        {stop.local && <LocalMap local={stop.local} room={room} others={others} city={stop.city} artist={artist} />}
      </div>

      <div className={s.what}>
        <h3 className={s.city}>{stop.label}</h3>
        <p className={s.score}>
          <span className={s.badge}>
            Fan city <b className="num">{stop.score.rank}</b> of <span className="num">{total}</span>
          </span>
          <span className={s.badge}>
            Affinity <b className="num">{pct(stop.score.affinity)}</b>
          </span>
        </p>
        {stop.why && (
          <p className={s.why}>
            <Checked text={stop.why} />
          </p>
        )}

        <dl className={s.facts}>
          {room && (
            <>
              <dt>Room</dt>
              <dd>
                <b>{room.name}</b>
                <span className={s.meta}>
                  {room.affinity !== undefined && <span className={s.aff}>Fan affinity {pct(room.affinity)}. </span>}
                  {room.capacity ? (
                    <>
                      Holds {room.capacity.value.toLocaleString("en-US")}, per{" "}
                      {/^https?:\/\//.test(room.capacity.source) ? (
                        <a href={room.capacity.source} target="_blank" rel="noreferrer" title={room.capacity.quote}>
                          {host(room.capacity.source)}
                        </a>
                      ) : (
                        <span title={room.capacity.quote}>{room.capacity.source}</span>
                      )}
                      .
                      {draw && fit(room, draw) !== "fits" && (
                        <span className={s.sizeNote}>
                          {" "}
                          {fit(room, draw) === "too small" ? "Small" : "Large"} for a usual crowd of {draw.toLocaleString("en-US")}: no room these fans go to here was confirmed to fit, so the pitch asks about {fit(room, draw) === "too small" ? "a second night or a bigger room" : "a reduced configuration"}.
                        </span>
                      )}
                    </>
                  ) : (
                    !pending && "Capacity not found on the web; ask the room."
                  )}
                </span>
                {others.length > 0 && <span className={s.alt}>Other rooms these fans go to: {others.map((r) => `${r.name}${r.capacity ? ` (holds ${r.capacity.value.toLocaleString("en-US")})` : r.affinity !== undefined ? ` (${pct(r.affinity)})` : ""}`).join(", ")}</span>}
              </dd>
            </>
          )}
          {opener && (
            <>
              <dt>Opener</dt>
              <dd>
                <b>{opener.name}</b>
                {opener.affinity !== undefined && <span className={s.meta}><span className={s.aff}>Audience affinity {pct(opener.affinity)}.</span></span>}
                {opener.shared.length > 0 && <span className={s.alt}>Shared tastes: {opener.shared.slice(0, 3).join(", ")}</span>}
              </dd>
            </>
          )}
          {independents(stop.posters).length > 0 && (
            <>
              <dt>Posters</dt>
              <dd>
                <Spots spots={independents(stop.posters)} />
                <span className={s.alt}>Where {artist} fans shop and hang out in {stop.city}.</span>
              </dd>
            </>
          )}
          {stop.after.length > 0 && (
            <>
              <dt>After</dt>
              <dd>
                <Spots spots={stop.after} />
                <span className={s.alt}>Where these fans go out here: the aftershow, or where to send the crew.</span>
              </dd>
            </>
          )}
        </dl>
      </div>

      <div className={s.pitch}>
        {pitch ? (
          <>
            <p className={s.subject}>
              <Checked text={pitch.subject} />
            </p>
            <div className={`${s.body} ${open ? s.bodyOpen : ""}`} id={`pitch-${stop.marketId}`}>
              {pitch.body.split("\n").map((line, i) => (line.trim() ? <p key={i}><Checked text={line} /></p> : null))}
            </div>
            {pitch.struck.length > 0 && (
              <p className={s.struck}>
                {pitch.struck.length} figure{pitch.struck.length > 1 ? "s" : ""} struck: not in this stop&apos;s evidence.
              </p>
            )}
            <div className={s.pitchActions}>
              <button type="button" aria-expanded={open} aria-controls={`pitch-${stop.marketId}`} onClick={() => setOpen(!open)}>
                {open ? "Show less" : "Read the pitch"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(`Subject: ${pitch.subject.replace(/~~[^~]+~~/g, "")}\n\n${pitch.body.replace(/~~[^~]+~~/g, "")}`).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? "Copied" : "Copy pitch"}
              </button>
              <a className={s.mail} href={`mailto:?subject=${encodeURIComponent(pitch.subject.replace(/~~[^~]+~~/g, ""))}&body=${encodeURIComponent(pitch.body.replace(/~~[^~]+~~/g, ""))}`}>
                Open in email
              </a>
            </div>
          </>
        ) : (
          <p className={s.pitchWait}>{pending ? "The pitch is drafted once every stop is routed." : "No pitch for this stop."}</p>
        )}
      </div>
    </li>
  );
}

/** "Mississippi Records (record store), Cloudforest (café)". */
function Spots({ spots }: { spots: Spot[] }) {
  return (
    <span>
      {spots.map((x, i) => (
        <span key={x.id}>
          {i > 0 && ", "}
          <b>{x.name}</b>
          {x.kind && <span className={s.kindNote}> ({x.kind.toLowerCase()})</span>}
        </span>
      ))}
    </span>
  );
}
