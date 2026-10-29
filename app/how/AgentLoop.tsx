import { EXTRA_CALLS, MAX_REVISIONS } from "@/lib/agent/plan";
import { MAX_LEG_KM } from "@/lib/geo/route";
import type { LogLine, Usage } from "@/lib/types";
import s from "./how.module.css";

/**
 * The agent loop as a route map, printed in the poster's two inks: three tracks (the model in fire, Qloo in blue,
 * the rules as a blue ring) and the run as one line stopping on them in order, with each step's call count from a
 * real run's call sheet. Two drawings of the same data: a wide one, and a narrow one for phones.
 */
type Lane = "model" | "qloo" | "rule";
type Step = { lane: Lane; title: string; note: string; count?: (c: Counts) => string; loop?: boolean };
type Counts = Record<string, number>;

const QLOO: [string, RegExp][] = [
  ["find", /^Who is/],
  ["heat", /^Where do .* over-index in /],
  ["audience", /by age and gender|growing\?|listen to\?|describe the music|podcasts|brands|films|TV|books/],
  ["scout", /^Which .* go to\?$|^Who could open/],
  ["advance", /street by street|go out in|see a poster|share\?$/],
  ["score", /each room, Routed/],
];
const MODEL: [string, RegExp][] = [
  ["control", /model alone, with no Qloo/],
  ["shortlist", /^Shortlisted/],
  ["book", /^Booked/],
  ["rebook", /re-booked after the check|^Wrote the reasons/],
  ["pitch", /hold requests/],
];

/** Calls per step in a run's call sheet; without a run, what a typical eight-show tour makes. */
export function countCalls(log?: LogLine[]): Counts {
  if (!log) return { find: 1, heat: 1, audience: 9, scout: 26, advance: 25, score: 1, control: 1, shortlist: 1, book: 1, rebook: 1, pitch: 1, stored: 0 };
  const c: Counts = { stored: 0 };
  for (const l of log) {
    const table = l.kind === "qloo" ? QLOO : l.kind === "model" ? MODEL : null;
    const hit = table?.find(([, re]) => re.test(l.text));
    if (hit) c[hit[0]] = (c[hit[0]] ?? 0) + 1;
    if (hit?.[0] === "heat" && /stored copy/.test(l.result ?? "")) c.stored = (c.stored ?? 0) + 1;
  }
  return c;
}

const n = (c: Counts, k: string) => String(c[k] ?? 0);

const STEPS: Step[] = [
  { lane: "qloo", title: "Find the artist", note: "The name typed becomes one Qloo entity, so every later call is about the right act.", count: (c) => n(c, "find") },
  { lane: "model", title: "The control group", note: "The same model routes the same shows with no Qloo, to be scored on the same evidence at the end.", count: (c) => n(c, "control") },
  { lane: "qloo", title: "The fan map", note: "A heatmap of the region, about 6,000 tiles (and a second through acts who sound alike when the artist's own map is thin). Kept in the store for a week, so routing the same artist again costs no call.", count: (c) => String((c.heat ?? 0) - (c.stored ?? 0)) },
  { lane: "qloo", title: "Who the fans are", note: "Age and gender, momentum, the sound and the mood, and what else they love: podcasts, brands, films, TV and books.", count: (c) => n(c, "audience") },
  { lane: "rule", title: "Tiles into cities", note: "Each tile goes to the city it sits in; cities are ranked by how far the fans over-index, weighed against size." },
  { lane: "model", title: "Shortlist", note: "From Qloo's fan cities, read in Qloo + population order, the cities worth a look, plus a few alternates.", count: (c) => n(c, "shortlist") },
  { lane: "qloo", title: "Scout every city", note: "The rooms these fans go to, of the kind the crowd needs, and the artists who share the audience. What each room holds is read from Wikidata and the web.", count: (c) => n(c, "scout") },
  { lane: "model", title: "Book", note: "One room per city and one support act for the whole run, each with a reason that cites the evidence.", count: (c) => n(c, "book") },
  { lane: "rule", title: "check_plan", note: `Radius clause, no leg over ${MAX_LEG_KM.toLocaleString("en-US")} km, room size, major markets. Every objection goes back to the agent.` },
  { lane: "model", title: "Re-book, then reasons", note: `The agent changes only what an objection names, up to ${MAX_REVISIONS} rounds; what still breaks, a rule settles, and the agent writes the reason for any stop a rule changed (${EXTRA_CALLS} calls at most).`, count: (c) => n(c, "rebook"), loop: true },
  { lane: "rule", title: "Route and date", note: "The shortest drive from the starting city, a day off after five shows, ferries and borders counted in hours." },
  { lane: "qloo", title: "The advance, per stop", note: "Where in the city the fans over-index, street by street; where to put up posters; where fans go after; what the two crowds share.", count: (c) => n(c, "advance") },
  { lane: "qloo", title: "Score both tours", note: "Every room from Routed's tour and the model-alone tour, scored against this artist's fans in one call.", count: (c) => n(c, "score") },
  { lane: "rule", title: "Size alone, for comparison", note: "The same rules re-plan the tour on city size alone, with no Qloo or model call: the stops Qloo changed." },
  { lane: "model", title: "Hold requests", note: "One pitch per room, written from that stop's evidence.", count: (c) => n(c, "pitch") },
  { lane: "rule", title: "Figure check", note: "Every figure in a pitch is checked against the evidence; any other figure is struck through on the page." },
];

const INK: Record<Lane, string> = { model: "var(--fire)", qloo: "var(--blue)", rule: "var(--blue)" };
const TEXT_INK: Record<Lane, string> = { model: "var(--fire-deep)", qloo: "var(--blue)", rule: "var(--blue)" };
const LANES: Lane[] = ["model", "qloo", "rule"];

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    if (line && (line + " " + w).length > max) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

type Geometry = { W: number; track: number; gap: number; textX: number; chars: number; title: number; note: number; lead: number; num: number; pad: number; ruleLabel: boolean };
const WIDE: Geometry = { W: 920, track: 34, gap: 52, textX: 200, chars: 76, title: 18, note: 15, lead: 21, num: 40, pad: 22, ruleLabel: true };
const NARROW: Geometry = { W: 380, track: 14, gap: 24, textX: 84, chars: 28, title: 16, note: 14, lead: 19, num: 30, pad: 18, ruleLabel: false };

function Drawing({ g, counts, className, label }: { g: Geometry; counts: Counts; className: string; label: string }) {
  const tx = (l: Lane) => g.track + LANES.indexOf(l) * g.gap;
  let y = 12;
  const rows = STEPS.map((st) => {
    const lines = wrap(st.note, g.chars);
    const top = y;
    const h = g.title + 8 + lines.length * g.lead + g.pad;
    y += h;
    return { st, lines, top, h, cy: top + g.title * 0.65 };
  });
  const H = y + 4;
  // The run's line: down its track, then across to the next one, like the route on the poster.
  const path = rows
    .map((r, i) => {
      const x = tx(r.st.lane);
      if (i === 0) return `M ${x} ${r.cy}`;
      const p = rows[i - 1]!;
      const px = tx(p.st.lane);
      if (px === x) return `L ${x} ${r.cy}`;
      const mid = (p.cy + r.cy) / 2;
      return `C ${px} ${mid}, ${x} ${mid}, ${x} ${r.cy}`;
    })
    .join(" ");
  const check = rows.find((r) => r.st.title === "check_plan")!;
  const again = rows.find((r) => r.st.loop)!;
  const loopX = g.track - Math.min(18, g.track - 4);
  return (
    <svg viewBox={`0 0 ${g.W} ${H}`} className={className} role="img" aria-label={label}>
      {LANES.map((l) => (
        <line key={l} x1={tx(l)} x2={tx(l)} y1={rows[0]!.cy} y2={rows.at(-1)!.cy} stroke={INK[l]} strokeOpacity="0.28" strokeWidth="1.5" strokeDasharray={l === "rule" ? "2 5" : undefined} />
      ))}
      <path d={path} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
      {/* check_plan's objections go back to the agent and its answer comes back to the check: up to two rounds. */}
      <path
        d={`M ${tx("model") - 9} ${again.cy} C ${loopX} ${again.cy}, ${loopX} ${check.cy}, ${tx("model")} ${check.cy - 0.01} L ${tx("rule") - 11} ${check.cy}`}
        fill="none"
        stroke="var(--fire)"
        strokeWidth="2"
        strokeDasharray="4 4"
        style={{ mixBlendMode: "multiply" }}
      />
      <path d={`M ${tx("rule") - 11} ${check.cy} l -7 -4.5 l 0 9 z`} fill="var(--fire)" />
      {rows.map(({ st, lines, top, cy }, i) => {
        const x = tx(st.lane);
        const count = st.count?.(counts);
        return (
          <g key={st.title}>
            {i > 0 && <line x1={g.textX} x2={g.W} y1={top - g.pad / 2 + 4} y2={top - g.pad / 2 + 4} stroke="var(--rule)" strokeWidth="1" />}
            {st.lane === "rule" ? (
              <circle cx={x} cy={cy} r={8} fill="var(--stock)" stroke="var(--blue)" strokeWidth="3" />
            ) : (
              <circle cx={x} cy={cy} r={9} fill={INK[st.lane]} style={{ mixBlendMode: "multiply" }} />
            )}
            <text x={g.textX} y={top + g.title} className={s.loopTitle} style={{ fontSize: g.title }}>
              {st.title}
            </text>
            {lines.map((l, k) => (
              <text key={k} x={g.textX} y={top + g.title + 8 + (k + 1) * g.lead - 4} className={s.loopNote} style={{ fontSize: g.note }}>
                {l}
              </text>
            ))}
            {count !== undefined ? (
              <>
                <text x={g.W} y={top + g.num * 0.86} textAnchor="end" className={s.loopNum} style={{ fontSize: g.num, fill: TEXT_INK[st.lane] }}>
                  {count}
                </text>
                <text x={g.W} y={top + g.num * 0.86 + 16} textAnchor="end" className={s.loopUnit}>
                  {st.lane === "qloo" ? (count === "1" ? "Qloo call" : "Qloo calls") : count === "1" ? "model call" : "model calls"}
                </text>
              </>
            ) : (
              g.ruleLabel && (
                <text x={g.W} y={top + g.title} textAnchor="end" className={s.loopUnit}>
                  rule, no call
                </text>
              )
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function AgentLoop({ log, usage, artist, typical }: { log?: LogLine[]; usage?: Usage; artist?: string; /** Measured on the poster wall ("81 to 104 Qloo requests and 6 model calls"). */ typical?: string }) {
  const counts = countCalls(log);
  const label = `The agent loop: ${STEPS.map((x) => `${x.title} (${x.lane === "rule" ? "a rule" : x.lane === "model" ? "the model" : "Qloo"})`).join(", then ")}. check_plan's objections go back to the model for up to ${MAX_REVISIONS} rounds.`;
  return (
    <figure className={s.loop}>
      <div className={s.loopKey}>
        <span className={s.keyModel}>The model decides</span>
        <span className={s.keyQloo}>Qloo looks it up</span>
        <span className={s.keyRule}>A rule checks</span>
        <span className={s.keyLoop}>Objections back to the agent</span>
      </div>
      <Drawing g={WIDE} counts={counts} className={s.loopWide} label={label} />
      <Drawing g={NARROW} counts={counts} className={s.loopNarrow} label={label} />
      <figcaption>
        {log && artist
          ? `Call counts from the run for ${artist} below${usage ? `: ${usage.qloo} Qloo requests over the network${usage.qlooCached ? ` (${usage.qlooCached} more answered from the cache)` : ""} and ${usage.modelCalls} model calls in all` : ""}.${typical ? ` The eight-show tours on the poster wall made ${typical}.` : ""}`
          : typical ? `The eight-show tours on the poster wall made ${typical}.` : "Call counts from a run appear here once a tour is on the poster wall."}
      </figcaption>
    </figure>
  );
}
