import "server-only";
import { demographics, describeRequest, recommend, tasteTags, trending } from "../qloo";
import type { Artist, Audience, Named } from "../types";
import { doorAdvice } from "./audience";
import type { Log } from "./tools";

/**
 * Who the fans are, from Qloo, in the shape a tour needs it: door policy (age skew), the sound and mood to
 * pitch rooms and openers with, the themes and dishes and films they love (copy, catering, aftershow), the
 * podcasts to pitch for press, and the brands to approach for merch and partners. Every list is Qloo's own
 * ranking for this artist's audience; nothing here is written by the model.
 */

const TAGS = {
  music: { type: "urn:tag:genre:music", ask: "What do these fans listen to?" },
  vibe: { type: "urn:tag:artist:qloo", ask: "How do these fans describe the music they love?" },
  themes: { type: "urn:tag:theme:qloo", ask: "Which themes do these fans connect with?" },
  food: { type: "urn:tag:specialty_dish:place", ask: "Which dishes do these fans seek out?" },
} as const;

const MEDIA = {
  podcasts: { type: "urn:entity:podcast", ask: "Which podcasts do these fans listen to (for press)?" },
  films: { type: "urn:entity:movie", ask: "Which films do these fans love?" },
  tv: { type: "urn:entity:tv_show", ask: "Which TV do these fans watch?" },
  books: { type: "urn:entity:book", ask: "Which books do these fans read?" },
  brands: { type: "urn:entity:brand", ask: "Which brands do these fans over-index on (merch and partners)?" },
} as const;

const clean = (s: string) => s.trim().replace(/\s+/g, " ");

export async function buildDossier(artist: Artist, log: Log): Promise<Audience> {
  const audience: Audience = { age: {}, gender: {}, tags: [], trend: [], brands: [], taste: {}, media: {} };
  const step = async (ask: string, fn: () => Promise<{ result: string; request?: string }>) => {
    const t = Date.now();
    try {
      const r = await fn();
      log({ kind: "qloo", text: ask.replace("these fans", `${artist.name} fans`), result: r.result, request: r.request, ms: Date.now() - t });
    } catch (e) {
      log({ kind: "qloo", text: ask.replace("these fans", `${artist.name} fans`), result: (e as Error).message, failed: true });
    }
  };
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 26 * 7 * 86_400_000).toISOString().slice(0, 10);

  await Promise.all([
    step("Who are these fans, by age and gender?", async () => {
      const r = await demographics(artist.id);
      if (r.skew) {
        audience.age = r.skew.age;
        audience.gender = r.skew.gender;
        audience.advice = doorAdvice(audience.age);
      }
      return { result: audience.advice ?? "No demographic skew came back.", request: describeRequest(r.request) };
    }),
    step("Is this audience growing?", async () => {
      const r = await trending(artist.id, "urn:entity:artist", start, end);
      // Qloo gives the percentile as 0–1.
      audience.trend = r.points.map((p) => ({ date: p.date, percentile: p.percentile === undefined ? undefined : p.percentile * 100, velocity: p.velocity }));
      const a = audience.trend[0]?.percentile, b = audience.trend.at(-1)?.percentile;
      return { result: a !== undefined && b !== undefined ? `Popularity percentile ${Math.round(a)} → ${Math.round(b)} over ${r.points.length} weeks` : "No trend data came back.", request: describeRequest(r.request) };
    }),
    ...Object.entries(TAGS).map(([key, t]) =>
      step(t.ask, async () => {
        const r = await tasteTags([artist.id], { tagTypes: [t.type], take: 10 });
        const list: Named[] = r.tags
          .filter((x) => x.name.toLowerCase() !== artist.name.toLowerCase())
          .map((x) => ({ id: x.id, name: clean(x.name), affinity: x.affinity }))
          .filter((x, i, all) => all.findIndex((y) => y.name.toLowerCase() === x.name.toLowerCase()) === i)
          .slice(0, 8);
        audience.taste![key as keyof typeof TAGS] = list;
        return { result: list.slice(0, 5).map((x) => x.name).join(", ") || "Nothing came back.", request: describeRequest(r.request) };
      }),
    ),
    ...Object.entries(MEDIA).map(([key, m]) =>
      step(m.ask, async () => {
        const r = await recommend({ type: m.type, signals: [artist.id], take: 8 });
        const list: Named[] = r.entities.map((e) => ({ id: e.id, name: clean(e.name), affinity: e.affinity, image: e.image }));
        if (key === "brands") audience.brands = list.slice(0, 8);
        else audience.media![key as Exclude<keyof typeof MEDIA, "brands">] = list.slice(0, 6);
        return { result: list.slice(0, 4).map((x) => x.name).join(", ") || "Nothing came back.", request: describeRequest(r.request) };
      }),
    ),
  ]);

  // The short list the agent and the pitches use: sound first, then mood.
  audience.tags = [...(audience.taste?.music ?? []).slice(0, 4), ...(audience.taste?.vibe ?? []).slice(0, 4)];
  return audience;
}
