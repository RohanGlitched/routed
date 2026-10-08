import "server-only";
import { createMcpHandler } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { opener, room } from "./agent/evidence";
import { HEAT_AREAS, scoreCities, type HeatTile } from "./agent/cities";
import { buildDossier } from "./agent/dossier";
import { runTour } from "./agent/run";
import { ipAllowed, QLOO_PER_TOUR, qlooRemaining, takeMcpRun, takeModelRun } from "./budget";
import { findMarket, REGIONS } from "./geo/markets";
import { hasKey } from "./nebius";
import { search, wherePopular } from "./qloo";
import { hotSpot, localTiles } from "./geo/local";
import { lookUpSpots } from "./agent/tools";
import { cityArea } from "./agent/rooms";
import { SITE_URL } from "./site";
import { loadTour, saveTour, updateTour } from "./store";
import { clientIp } from "./visitor";
import { newTourId, TOUR_ID, type Plan, type TourRecord } from "./types";

/**
 * Routed as an MCP server (Streamable HTTP at /api/mcp), so any agent that speaks the Model Context Protocol,
 * such as Claude, ChatGPT or an IDE assistant, can route a tour on Qloo's taste graph from a conversation.
 * Tools return the short version as text and link the full tour book; nothing here needs an account.
 */

export const SERVER_INSTRUCTIONS = `Routed routes concert tours for independent artists from Qloo's taste graph: the cities where an artist's fans over-index, the rooms those fans go to, the openers who share the audience, dated by touring rules, with a checked pitch per venue.
Use fan_map for "where are this artist's fans", fan_profile for "who are the fans / what else do they like / who to pitch", and route_tour to plan a whole tour (it takes about a minute and returns a link to the full tour book with the poster). get_tour reads back a tour book by its link or id.
Qloo affinity says where fans over-index, not ticket sales; say so if asked for sales forecasts.`;

const regionArg = z.enum(["na", "uk", "eu"]).optional().describe("North America (na), UK and Ireland (uk) or mainland Europe (eu). Defaults to na.");

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const link = (id: string) => `${SITE_URL}/tour/${id}`;

function summary(rec: TourRecord): string {
  const p = rec.plan as Plan | undefined;
  if (!p?.stops?.length) return rec.status === "failed" ? `The routing stopped: ${rec.error ?? "unknown error"}` : `Still routing. Tour book: ${link(rec.id)}`;
  const lines = [
    `${p.artist.name}: ${p.stops.length} shows, ${p.stops[0]!.date} to ${p.stops.at(-1)!.date}, from ${p.from.label}, about ${p.totalKm.toLocaleString("en-US")} km.`,
    ...p.stops.map((s, i) => {
      const r = room(s);
      const o = opener(s);
      return `${i + 1}. ${s.date} ${s.label} (fan city #${s.score.rank} of ${p.cities.length}): ${r?.name ?? "room to confirm"}${r?.capacity ? `, holds ${r.capacity.value.toLocaleString("en-US")}` : ""}${o ? `; opener ${o.name}` : ""}`;
    }),
  ];
  if (p.guess) lines.push(`Without Qloo, the same model's cities averaged #${Math.round(p.guess.rankMean.guess ?? 0)} on ${p.artist.name}'s fan map; Routed's averaged #${Math.round(p.guess.rankMean.routed ?? 0)}.`);
  if (p.audience?.advice) lines.push(p.audience.advice);
  lines.push(`Tour book with the poster, pitches and every Qloo call: ${link(rec.id)}`);
  return lines.join("\n");
}

function register(server: McpServer) {
  server.registerTool(
    "fan_map",
    {
      title: "Where an artist's fans over-index",
      description: "Ranks the cities in a region where the artist's fans over-index on Qloo's heatmap (strongest first). No model; one search and one heatmap call, a few seconds.",
      inputSchema: z.object({ artist: z.string().min(1).max(80), region: regionArg, top: z.number().int().min(3).max(40).optional() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ artist, region = "na", top = 15 }) => {
      const found = await search(artist, "urn:entity:artist", 1);
      const a = found.entities[0];
      if (!a) return text(`Qloo has no artist called "${artist}".`);
      const tiles = (await Promise.all(HEAT_AREAS[region].map((area) => wherePopular(a.id, area.within, 50).then((r) => r.tiles).catch(() => [] as HeatTile[])))).flat();
      const cities = scoreCities(tiles, region);
      if (!cities.length) return text(`Qloo's heatmap has no ${REGIONS[region].name} cities for ${a.name}.`);
      return text(
        [`Where ${a.name} fans over-index in ${REGIONS[region].name} (${cities.length} cities with fans; strength = affinity x taste signal):`, ...cities.slice(0, top).map((c) => `#${c.rank} ${c.label}: affinity ${Math.round(c.affinity * 100)}`)].join("\n"),
      );
    },
  );

  server.registerTool(
    "fan_profile",
    {
      title: "Who an artist's fans are",
      description: "Qloo's profile of an artist's audience: age skew and door advice, the sound and mood they love, themes, dishes, and the podcasts, brands, films, TV and books they over-index on.",
      inputSchema: z.object({ artist: z.string().min(1).max(80) }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ artist }) => {
      const found = await search(artist, "urn:entity:artist", 1);
      const e = found.entities[0];
      if (!e) return text(`Qloo has no artist called "${artist}".`);
      const d = await buildDossier({ id: e.id, name: e.name, genres: [] }, () => {});
      const list = (label: string, xs?: { name: string }[]) => (xs?.length ? `${label}: ${xs.slice(0, 6).map((x) => x.name).join(", ")}` : null);
      return text(
        [
          `${e.name}'s fans, from Qloo:`,
          d.advice ?? null,
          list("Sound", d.taste?.music),
          list("Mood", d.taste?.vibe),
          list("Themes", d.taste?.themes),
          list("Dishes", d.taste?.food),
          list("Podcasts (press)", d.media?.podcasts),
          list("Brands (merch and partners)", d.brands),
          list("Films", d.media?.films),
          list("TV", d.media?.tv),
          list("Books", d.media?.books),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  );

  server.registerTool(
    "fan_neighbourhoods",
    {
      title: "Where in a city an artist's fans are",
      description: "Qloo's heatmap at street level for one city: the neighbourhood where the artist's fans over-index most, how strong it is, and the record stores, bookshops and cafés there for a poster run. No model; three Qloo calls.",
      inputSchema: z.object({ artist: z.string().min(1).max(80), city: z.string().min(2).max(80).describe("A touring city, e.g. 'Portland, OR' or 'Manchester, UK'") }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ artist, city }) => {
      const m = findMarket(city);
      if (!m) return text(`Routed doesn't know "${city}" as a city. Try the nearest bigger city.`);
      const found = await search(artist, "urn:entity:artist", 1);
      const a = found.entities[0];
      if (!a) return text(`Qloo has no artist called "${artist}".`);
      const r = await wherePopular(a.id, cityArea(m), 50);
      const tiles = localTiles(r.tiles);
      const hot = hotSpot(tiles);
      if (!hot) return text(`Qloo's heatmap has no tiles for ${a.name} fans in ${m.name}.`);
      const art = { id: a.id, name: a.name, genres: [] };
      const shops = await lookUpSpots("posters", art, [m.ascii, m.cc, m.cc === "US" ? m.state : ""].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-"), () => {}, [], hot);
      const area = shops.find((s) => s.area)?.area;
      const strong = tiles.filter((t) => t[2] >= 0.8).length;
      return text(
        [
          `${a.name} fans in ${m.name}: ${r.tiles.length} street-level tiles on Qloo's heatmap; ${strong} of them in the top fifth of the city's strength.`,
          `Strongest area: ${area ?? "around"} ${hot.lat.toFixed(3)}, ${hot.lon.toFixed(3)}.`,
          shops.length ? `Poster run there: ${shops.map((s) => `${s.name}${s.kind ? ` (${s.kind.toLowerCase()})` : ""}`).join(", ")}.` : "No shops came back for a poster run.",
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "route_tour",
    {
      title: "Route a tour",
      description: "Plans a whole tour: Qloo finds the fan cities, rooms and openers, an agent picks them, rules route and date it, and each room gets a checked pitch. Takes about a minute. Returns the dates, rooms and openers and a link to the full tour book.",
      inputSchema: z.object({
        artist: z.string().min(1).max(80),
        from: z.string().min(2).max(80).describe("Starting city, e.g. 'Portland, OR', 'Leeds, UK', 'Berlin'"),
        shows: z.number().int().min(3).max(16).optional().describe("Number of shows, default 8"),
        first_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date of the first show; default about five months out"),
        draw: z.number().int().min(50).max(20000).optional().describe("How many people the artist usually draws; rooms are sized to it"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ artist, from, shows = 8, first_date, draw }) => {
      if (!findMarket(from)) return text(`Routed doesn't know "${from}" as a city. Try the nearest bigger city, like "Portland, OR" or "Leeds, UK".`);
      const firstDate = first_date ?? new Date(Date.now() + 150 * 86_400_000).toISOString().slice(0, 10);
      const parsed = new Date(`${firstDate}T12:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== firstDate) return text(`"${firstDate}" isn't a real date.`);
      if (parsed.getTime() < Date.now()) return text("The first show needs to be in the future.");
      if (!ipAllowed(`mcp:${await clientIp().catch(() => "unknown")}`)) return text("That's a lot of tours from one place in a few minutes. Try again in ten.");
      if ((await qlooRemaining()) < QLOO_PER_TOUR) return text("Routed has used today's Qloo allowance; try again tomorrow, or read a finished tour with get_tour.");
      if (!(await takeMcpRun())) return text("The MCP endpoint has routed its share of tours for today; the site at https://routed-tours.vercel.app still can.");
      const rec: TourRecord = { id: newTourId(), createdAt: new Date().toISOString(), status: "running", startedAt: new Date().toISOString(), input: { artist, from, firstDate, shows, ...(draw ? { draw } : {}) }, log: [] };
      await saveTour(rec);
      const useModel = hasKey() && (await takeModelRun());
      let plan: Partial<Plan> = {};
      for await (const e of runTour(rec.input, useModel)) {
        if (e.t === "log") rec.log.push(e.line);
        else if (e.t === "plan") plan = { ...plan, ...e.plan };
        else if (e.t === "error") {
          rec.status = "failed";
          rec.error = e.message;
        } else if (e.t === "done") {
          rec.status = "done";
          rec.engine = e.engine;
          rec.finishedAt = e.at;
        }
      }
      if (rec.status === "running") rec.status = "failed";
      rec.plan = plan as Plan;
      await updateTour(rec.id, () => rec);
      return text(summary(rec));
    },
  );

  server.registerTool(
    "get_tour",
    {
      title: "Read a tour book",
      description: "Reads back a Routed tour book by its link or id: dates, rooms, openers, the comparison with the model alone, and the link.",
      inputSchema: z.object({ tour: z.string().min(10).max(200).describe("The tour book link or its 10-character id") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ tour }) => {
      const id = tour.trim().split("/").pop() ?? "";
      if (!TOUR_ID.test(id)) return text("That isn't a Routed tour link.");
      const rec = await loadTour(id);
      return text(rec ? summary(rec) : "No tour with that link.");
    },
  );
}

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

const inner = createMcpHandler(register, { serverInfo: { name: "Routed", version: "1.0.0" }, instructions: SERVER_INSTRUCTIONS });

export async function mcpHandler(req: Request): Promise<Response> {
  const res = await inner(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
