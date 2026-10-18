import { findMarket, marketId, nearestMarket, type RegionId } from "./geo/markets";

/**
 * Reads the shows off a Wikipedia tour article (wikitext), for the head-to-head's held-out artists. The rule is
 * mechanical so nobody picks which shows count: every row of a table whose header has a "City" column, with
 * rowspans carried down; tables under a heading or caption that says "cancel" are skipped, and so is any row that
 * says cancelled or postponed, or whose cells name a festival. The city cell's link target is used when there is
 * one ("[[Portland, Oregon|Portland]]" is Portland, OR), and the country cell decides the region.
 */

export type ShowRow = { date: string; city: string; country: string; venue: string };

const FESTIVALS =
  /festival|\bfest\b|fest\]|open air|lollapalooza|coachella|bonnaroo|glastonbury|primavera|roskilde|rock am ring|rock im park|hellfest|governors ball|austin city limits|outside lands|osheaga|pukkelpop|werchter|sziget|mad cool|lowlands|pinkpop|wacken|graspop|bumbershoot|firefly|boston calling|shaky knees|life is beautiful|electric forest|bottlerock|summerfest|stagecoach|when we were young|riot fest|aftershock|welcome to rockville|sonic temple|louder than life|corona capital|rock werchter|nos alive|bilbao bbk|benicassim|tw classic|best kept secret|way out west|flow festival|nova rock|isle of wight|tramlines|boardmasters|all points east|bst hyde park|trnsmt|electric picnic|creamfields|reading festival|la route du rock|rock en seine|les vieilles charrues|lollapalooza|montreux jazz|paléo|paleo|gurtenfestival|openair/i;

/** The region a country cell puts a show in, or undefined outside the three regions Routed routes. */
export function regionOfCountry(country: string): RegionId | undefined {
  const c = country.toLowerCase().trim();
  if (/^(united states|us|usa|u\.s\.|canada)$/.test(c)) return "na";
  if (/^(united kingdom|uk|england|scotland|wales|northern ireland|ireland|republic of ireland)$/.test(c)) return "uk";
  if (EUROPE.has(c)) return "eu";
  return undefined;
}

const EUROPE = new Set(
  "germany france netherlands the netherlands belgium luxembourg spain portugal italy switzerland austria denmark sweden norway finland poland czech republic czechia hungary slovakia slovenia croatia iceland estonia latvia lithuania greece romania bulgaria serbia"
    .split(" ")
    .concat(["czech republic", "the netherlands"]),
);

/** Splits a wikitext line on a top-level separator, ignoring the ones inside [[links]] and {{templates}}. */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === "[[" || two === "{{") {
      depth++;
      cur += two;
      i++;
      continue;
    }
    if ((two === "]]" || two === "}}") && depth > 0) {
      depth--;
      cur += two;
      i++;
      continue;
    }
    if (depth === 0 && s.slice(i, i + sep.length) === sep) {
      out.push(cur);
      cur = "";
      i += sep.length - 1;
      continue;
    }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

type Cell = { raw: string; text: string; link?: string; rowspan: number; colspan: number };

function cell(raw: string): Cell {
  // "rowspan="3" | [[Toronto]]": attributes, then the content after the first top-level pipe.
  const parts = splitTop(raw, "|");
  let attrs = "", content = raw;
  if (parts.length > 1 && /^\s*(rowspan|colspan|style|scope|class|align|width|bgcolor|data-sort-value)\b[^[{]*$/i.test(parts[0]!)) {
    attrs = parts[0]!;
    content = parts.slice(1).join("|");
  } else if (/^\s*(rowspan|colspan)\s*=\s*"?\d+"?\s*\{\{/i.test(raw)) {
    // "rowspan="6" {{N/A}}" with no pipe.
    attrs = raw.slice(0, raw.indexOf("{{"));
    content = raw.slice(raw.indexOf("{{"));
  }
  const rowspan = Number(/rowspan\s*=\s*"?(\d+)/i.exec(attrs)?.[1] ?? 1);
  const colspan = Number(/colspan\s*=\s*"?(\d+)/i.exec(attrs)?.[1] ?? 1);
  const link = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/.exec(content)?.[1]?.trim();
  return { raw: content, text: clean(content), link, rowspan, colspan };
}

/** Wikitext to plain text: refs, templates, links, tags and bold or italic marks removed. */
export function clean(s: string): string {
  let t = s.replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  for (let i = 0; i < 6 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{[^{}]*\}\}/g, "");
  return t
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/'{2,}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every show row in the article's date tables (see the rule above). */
export function showRows(wikitext: string): ShowRow[] {
  const rows: ShowRow[] = [];
  const lines = wikitext.split("\n");
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const h = /^(=+)\s*(.*?)\s*=+\s*$/.exec(lines[i]!);
    if (h) {
      heading = h[2]!;
      continue;
    }
    if (!lines[i]!.trim().startsWith("{|")) continue;
    // Collect the table (nested tables are rare in tour articles; the first "|}" at the start of a line ends it).
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !lines[j]!.trim().startsWith("|}"); j++) body.push(lines[j]!);
    i = j;
    if (/cancel/i.test(heading)) continue;
    const caption = body.find((l) => l.trim().startsWith("|+")) ?? "";
    if (/cancel/i.test(caption)) continue;
    rows.push(...tableRows(body));
  }
  return rows;
}

function tableRows(body: string[]): ShowRow[] {
  // Split into rows on "|-"; each row's cells come from lines starting "|" or "!" (with "||" and "!!" inline).
  const groups: string[][] = [[]];
  for (const l of body) {
    const t = l.trim();
    if (t.startsWith("|+")) continue;
    if (t.startsWith("|-")) {
      groups.push([]);
      continue;
    }
    if (t.startsWith("|") || t.startsWith("!")) groups.at(-1)!.push(t);
    else if (groups.at(-1)!.length) groups.at(-1)![groups.at(-1)!.length - 1] += " " + t;
  }
  const rawCells = (g: string[]) => g.flatMap((l) => splitTop(l.slice(1), l.startsWith("!") ? "!!" : "||").flatMap((x) => (l.startsWith("!") ? splitTop(x, "||") : [x])));
  let header: string[] | null = null;
  const out: ShowRow[] = [];
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
    // A repeated header row (a table split by year) starts over.
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
    const whole = row.map((c) => c.raw).join(" ");
    if (/cancel|postpon/i.test(whole)) continue;
    if (FESTIVALS.test(row[iVenue]?.raw ?? "") || FESTIVALS.test(row[iDate]?.raw ?? "")) continue;
    const city = row[iCity];
    if (!city || !city.text) continue;
    out.push({ date: row[iDate]?.text ?? "", city: city.link ?? city.text, country: row[iCountry]?.text ?? "", venue: row[iVenue]?.text ?? "" });
  }
  return out;
}

/**
 * The touring markets a tour's rows played, by region: by name, else the nearest market within 60 km of the town's
 * coordinates (Morrison is Denver; Rosemont is Chicago). A town with no touring market within reach is left out.
 */
export function marketsByRegion(rows: ShowRow[], at: Record<string, [number, number]> = {}): Record<RegionId, string[]> {
  const out: Record<RegionId, string[]> = { na: [], uk: [], eu: [] };
  for (const r of rows) {
    const region = regionOfCountry(r.country);
    if (!region) continue;
    const p = at[r.city];
    const m = findMarket(r.city, region) ?? findMarket(r.city.split(",")[0]!, region) ?? (p ? nearestMarket({ lat: p[0], lon: p[1] }, region, 60) : null);
    if (!m) continue;
    const id = marketId(m);
    if (!out[region].includes(id)) out[region].push(id);
  }
  return out;
}

/** The infobox's artist, when it names exactly one (co-headline tours are left out). */
export function infoboxArtist(wikitext: string): string | undefined {
  const m = /\|\s*artist\s*=\s*(.+)/.exec(wikitext);
  if (!m) return undefined;
  const v = m[1]!.replace(/<ref[\s\S]*$/i, "");
  const links = [...v.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)];
  if (links.length > 1 || /<br|\{\{(hlist|flatlist|ubl|plainlist)/i.test(v)) return undefined;
  const name = links.length ? (links[0]![2] ?? links[0]![1]!) : clean(v);
  const n = clean(name).replace(/\s*\(.*?\)\s*$/, "").trim();
  return n || undefined;
}
