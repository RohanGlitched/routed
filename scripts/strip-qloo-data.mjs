// M8, Qloo's developer terms: no Qloo response data in the repository. Removes from the committed test data the
// Qloo ids and Qloo's own names for artists, and the lists Qloo returned (its top rooms per city, its support
// picks), keeping what /proof reads: hit counts, ranks, the real tours' cities and the model's answers. Idempotent;
// run it after any script stage that rewrites these files.
//   node scripts/strip-qloo-data.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const DIRS = ["data/head-to-head", "data/outside2"];
/** Keys that hold Qloo's own data, anywhere in a file. */
const QLOO_KEYS = new Set(["qlooId", "qlooName"]);
/** In the venue test, the room lists Qloo returned (artist signal, Routed's measuring order, popularity only). */
const QLOO_TOP = ["qloo", "routedOrder", "popular"];

const strip = (v) => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !QLOO_KEYS.has(k)).map(([k, x]) => [k, strip(x)]));
  return v;
};

let changed = 0;
for (const dir of DIRS) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const path = `${dir}/${f}`;
    const text = readFileSync(path, "utf8");
    const data = strip(JSON.parse(text));
    if (path === "data/outside2/results.json") {
      for (const row of data.venues?.rows ?? []) for (const c of row.cities ?? []) for (const k of QLOO_TOP) if (c.top) delete c.top[k];
      for (const row of data.support?.rows ?? []) delete row.qloo;
    }
    // Round 4's room test (Oct 30): the lists Qloo returned per city (artist signal, popularity only, popularity with
    // affinity, and Routed's list before the agent's choice) go; the ranks, hits, the booked room and the model's and
    // Wikidata's lists stay. Stripped Oct 30, after the round 2 judges found them in 73f7861 (history kept).
    if (path === "data/outside2/rooms4.json") for (const row of data.rows ?? []) for (const c of row.cities ?? []) for (const k of ["qloo", "popular", "popAffinity", "shippedNoChoice"]) if (c.top) delete c.top[k];
    // A Windows checkout may carry CRLF: compare and indent as LF, so a file nothing was stripped from stays put.
    const lf = text.replace(/\r\n/g, "\n");
    const indent = /^\{\n( +)"/.exec(lf)?.[1]?.length ?? 0;
    const out = JSON.stringify(data, null, indent || undefined) + (lf.endsWith("\n") ? "\n" : "");
    if (out !== lf) {
      writeFileSync(path, out);
      changed++;
      console.log(`stripped ${path}`);
    }
  }
}
console.log(changed ? `${changed} files changed` : "nothing to strip");
