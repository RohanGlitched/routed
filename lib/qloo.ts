import "server-only";

/**
 * The Qloo Insights API (hackathon host, X-Api-Key header). Each function is one of the workflows in Qloo's own
 * harness (@qloo/qloo-harness: describe, where_popular, recommend, compare_audiences, audience_demographics,
 * entity_tags, trends, find_tags) with the same query parameters, called directly so it runs on serverless.
 *
 * Qloo silently ignores parameters it doesn't support for a filter.type and answers 200 with nothing, so every
 * call records the exact request (for the run log and the "how" page) and an empty result is reported as such,
 * never papered over.
 */
const BASE = process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";

export const hasQloo = () => Boolean(process.env.QLOO_API_KEY);

export type Query = Record<string, string | number | boolean | undefined>;

/** A request as shown to people: path and parameters, never the key. */
export type QlooRequest = { path: string; query: Record<string, string> };

export class QlooError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly request: QlooRequest,
  ) {
    super(message);
  }
}

const memo = new Map<string, { at: number; body: unknown }>();
const TTL_MS = 6 * 3600_000;

/** One GET. Cached for six hours per URL (taste data moves weekly); retried once on a 429 or 5xx. */
export async function qlooGet<T>(path: string, query: Query, timeoutMs = 20_000): Promise<{ body: T; request: QlooRequest }> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") q[k] = String(v);
  const request = { path, query: q };
  const url = `${BASE}${path}?${new URLSearchParams(q).toString()}`;
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return { body: hit.body as T, request };
  if (!hasQloo()) throw new QlooError("QLOO_API_KEY is not set", 0, request);

  let last: QlooError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 800));
    let r: Response;
    try {
      r = await fetch(url, { headers: { "X-Api-Key": process.env.QLOO_API_KEY!, accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      last = new QlooError(`Qloo didn't answer (${(e as Error).name === "TimeoutError" ? "timed out" : "network error"})`, 0, request);
      continue;
    }
    if (r.ok) {
      const body = (await r.json()) as T;
      memo.set(url, { at: Date.now(), body });
      if (memo.size > 2000) memo.delete(memo.keys().next().value!);
      return { body, request };
    }
    const text = (await r.text()).slice(0, 300);
    console.error(`[qloo] ${path} HTTP ${r.status}: ${text}`);
    last = new QlooError(qlooMessage(r.status, text), r.status, request);
    if (r.status !== 429 && r.status < 500) break;
  }
  throw last!;
}

function qlooMessage(status: number, text: string): string {
  if (status === 401 || status === 403) return "Qloo refused the API key.";
  if (status === 429) return "Qloo's rate limit was hit; try again in a minute.";
  if (status === 404) return "Qloo found nothing for that.";
  if (status === 400) {
    // 400 is how Qloo says a location or name didn't resolve.
    try {
      const j = JSON.parse(text) as { message?: string; reason?: string };
      return `Qloo couldn't use that request${j.message ? `: ${j.message}` : ""}.`;
    } catch {
      return "Qloo couldn't use that request.";
    }
  }
  return `Qloo answered ${status}.`;
}

/* ───────────────────────── shapes ───────────────────────── */

export type Entity = {
  id: string;
  name: string;
  subtype?: string;
  image?: string;
  popularity?: number;
  affinity?: number;
  disambiguation?: string;
  tags: { id: string; name: string; type?: string }[];
  /** Place fields when present. */
  place?: { address?: string; city?: string; region?: string; country?: string; lat?: number; lon?: number; rating?: number; priceLevel?: number; website?: string; phone?: string; isClosed?: boolean };
  /** Short description when Qloo has one. */
  description?: string;
  /** For artists: where they're from, which helps with "local opener". */
  bornIn?: string;
};

type RawEntity = {
  entity_id?: string;
  id?: string;
  name?: string;
  subtype?: string;
  type?: string;
  popularity?: number;
  disambiguation?: string;
  query?: { affinity?: number; distance?: number };
  affinity?: number;
  tags?: { id?: string; tag_id?: string; name?: string; type?: string }[];
  properties?: Record<string, unknown> & {
    image?: { url?: string };
    geocode?: Record<string, unknown>;
    address?: string;
    description?: string;
    short_description?: string;
    business_rating?: number;
    price_level?: number;
    website?: string;
    phone?: string;
    is_closed?: boolean;
    place_of_birth?: string;
  };
  location?: { lat?: number; lon?: number; lng?: number };
} & Record<string, unknown>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Accepts the nested (properties.*) and flat shapes the docs show, so a shape surprise loses a field, not a run. */
export function toEntity(e: RawEntity): Entity {
  const p = e.properties ?? {};
  const g = (p.geocode ?? {}) as Record<string, unknown>;
  const flat = e as Record<string, unknown>;
  const lat = num(p.lat ?? g.lat ?? flat.lat ?? e.location?.lat);
  const lon = num(p.lon ?? p.lng ?? g.lon ?? g.lng ?? flat.lon ?? e.location?.lon ?? e.location?.lng);
  const isPlace = (e.subtype ?? "").includes("place") || lat !== undefined;
  return {
    id: String(e.entity_id ?? e.id ?? ""),
    name: String(e.name ?? ""),
    subtype: e.subtype,
    image: str(p.image?.url),
    popularity: num(e.popularity),
    affinity: num(e.query?.affinity ?? e.affinity),
    disambiguation: str(e.disambiguation),
    tags: (e.tags ?? []).map((t) => ({ id: String(t.id ?? t.tag_id ?? ""), name: String(t.name ?? ""), type: t.type })).filter((t) => t.id && t.name),
    description: str(p.short_description) ?? str(p.description),
    bornIn: str(p.place_of_birth),
    ...(isPlace
      ? {
          place: {
            address: str(p.address ?? flat.address),
            city: str(g.city ?? p.city ?? flat.city),
            region: str(g.admin1_region ?? p.admin1_region ?? flat.admin1_region),
            country: str(g.country_code ?? g.country ?? flat.country_code),
            lat,
            lon,
            rating: num(p.business_rating ?? flat.business_rating),
            priceLevel: num(p.price_level ?? flat.price_level),
            website: str(p.website ?? flat.website),
            phone: str(p.phone ?? flat.phone),
            isClosed: typeof (p.is_closed ?? flat.is_closed) === "boolean" ? Boolean(p.is_closed ?? flat.is_closed) : undefined,
          },
        }
      : {}),
  };
}

const entitiesOf = (body: unknown): RawEntity[] => {
  const r = (body as { results?: unknown })?.results;
  if (Array.isArray(r)) return r as RawEntity[];
  const e = (r as { entities?: unknown })?.entities;
  return Array.isArray(e) ? (e as RawEntity[]) : [];
};

/* ───────────────────────── workflows ───────────────────────── */

/** describe: resolve a name to Qloo entities (search). Best match first. */
export async function search(query: string, type = "urn:entity:artist", take = 5) {
  try {
    const { body, request } = await qlooGet("/search", { query, types: type, take });
    return { entities: entitiesOf(body).map(toEntity).filter((e) => e.id), request };
  } catch (e) {
    // Search answers 404 when nothing matches.
    if (e instanceof QlooError && e.status === 404) return { entities: [], request: e.request };
    throw e;
  }
}

export type Tile = { lat: number; lon: number; geohash?: string; affinity: number; rank?: number; popularity?: number };

/** where_popular: geohash tiles where the entity's fans over-index, inside `within` (a place name or WKT). */
export async function wherePopular(entityId: string, within: string, take = 50) {
  const isWkt = /^(POINT|POLYGON|MULTIPOLYGON)\s*\(/i.test(within);
  const { body, request } = await qlooGet("/v2/insights", {
    "filter.type": "urn:heatmap",
    "signal.interests.entities": entityId,
    ...(isWkt ? { "filter.location": within } : { "filter.location.query": within }),
    take,
  });
  const raw = ((body as { results?: { heatmap?: unknown[] } })?.results?.heatmap ?? []) as {
    location?: { latitude?: number; longitude?: number; lat?: number; lon?: number; geohash?: string };
    query?: { affinity?: number; affinity_rank?: number; popularity?: number };
  }[];
  const tiles: Tile[] = raw
    .map((t) => ({
      lat: num(t.location?.latitude ?? t.location?.lat) ?? NaN,
      lon: num(t.location?.longitude ?? t.location?.lon) ?? NaN,
      geohash: t.location?.geohash,
      affinity: num(t.query?.affinity) ?? 0,
      rank: num(t.query?.affinity_rank),
      popularity: num(t.query?.popularity),
    }))
    .filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lon));
  return { tiles, request };
}

/** recommend: entities of `type` for a taste profile, optionally inside a place and with tag filters. */
export async function recommend(opts: {
  type: string;
  signals?: string[];
  signalLocation?: string;
  filterLocation?: string;
  tags?: string[];
  excludeTags?: string[];
  exclude?: string[];
  take?: number;
  extra?: Query;
}) {
  const { body, request } = await qlooGet("/v2/insights", {
    "filter.type": opts.type,
    "signal.interests.entities": opts.signals?.join(","),
    "signal.location.query": opts.signalLocation,
    "filter.location.query": opts.filterLocation,
    "filter.tags": opts.tags?.join(","),
    "filter.exclude.tags": opts.excludeTags?.join(","),
    "filter.exclude.entities": opts.exclude?.join(","),
    take: opts.take ?? 10,
    ...opts.extra,
  });
  return { entities: entitiesOf(body).map(toEntity).filter((e) => e.id), request };
}

export type Skew = { age: Record<string, number>; gender: Record<string, number> };

/** audience_demographics: signed over/under-index by age bucket and gender. */
export async function demographics(entityId: string) {
  const { body, request } = await qlooGet("/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": entityId });
  const rows = ((body as { results?: { demographics?: unknown[] } })?.results?.demographics ?? []) as { entity_id?: string; query?: { age?: Record<string, number>; gender?: Record<string, number> } }[];
  const row = rows.find((r) => r.entity_id === entityId) ?? rows[0];
  const skew: Skew | null = row?.query ? { age: row.query.age ?? {}, gender: row.query.gender ?? {} } : null;
  return { skew, request };
}

export type TasteTag = { id: string; name: string; type?: string; affinity?: number };

/** entity_tags: the concepts that characterise an entity's audience (taste analysis), optionally by tag type. */
export async function tasteTags(entityIds: string[], opts: { tagTypes?: string[]; take?: number } = {}) {
  const { body, request } = await qlooGet("/v2/insights", {
    "filter.type": "urn:tag",
    "signal.interests.entities": entityIds.join(","),
    "filter.tag.types": opts.tagTypes?.join(","),
    take: opts.take ?? 12,
  });
  const raw = ((body as { results?: { tags?: unknown[] } })?.results?.tags ?? []) as { tag_id?: string; id?: string; name?: string; subtype?: string; type?: string; query?: { affinity?: number } }[];
  const tags: TasteTag[] = raw.map((t) => ({ id: String(t.tag_id ?? t.id ?? ""), name: String(t.name ?? ""), type: t.subtype ?? t.type, affinity: num(t.query?.affinity) })).filter((t) => t.id && t.name);
  return { tags, request };
}

export type TrendPoint = { date: string; percentile?: number; rank?: number; velocity?: number; fold?: number; delta?: number };

/** trends: weekly popularity for one entity between two dates, oldest first. */
export async function trending(entityId: string, type: string, start: string, end: string) {
  const { body, request } = await qlooGet("/v2/trending", { "filter.type": type, "signal.interests.entities": entityId, "filter.start_date": start, "filter.end_date": end, take: 50 });
  const raw = ((body as { results?: { trending?: unknown[] } })?.results?.trending ?? []) as Record<string, unknown>[];
  const points: TrendPoint[] = raw
    .map((p) => ({ date: String(p.date ?? ""), percentile: num(p.population_percentile), rank: num(p.population_rank), velocity: num(p.population_rank_velocity), fold: num(p.velocity_fold_change), delta: num(p.population_percent_delta) }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}/.test(p.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { points, request };
}

/** compare_audiences: how two groups of entities differ and overlap. The shape is undocumented, so it's kept raw
 *  alongside whatever named items with scores we can find in it. */
export async function compareAudiences(a: string[], b: string[], opts: { type?: string; subtype?: string; take?: number } = {}) {
  const { body, request } = await qlooGet("/v2/analysis/compare", {
    "a.signal.interests.entities": a.join(","),
    "b.signal.interests.entities": b.join(","),
    "filter.type": opts.type,
    "filter.subtype": opts.subtype,
    take: opts.take ?? 10,
  });
  return { body, request };
}

/** find_tags: tag URNs for a natural-language concept ("music venue"). */
export async function findTags(query: string, opts: { tagTypes?: string[]; semantic?: boolean; take?: number } = {}) {
  const { body, request } = await qlooGet("/v2/tags", {
    "filter.query": query,
    "feature.semantic_search": opts.semantic ?? true,
    "filter.tag.types": opts.tagTypes?.join(","),
    take: opts.take ?? 10,
  });
  const r = (body as { results?: { tags?: unknown[] } | unknown[] })?.results;
  const raw = (Array.isArray(r) ? r : (r?.tags ?? [])) as { id?: string; tag_id?: string; name?: string; type?: string; subtype?: string }[];
  return { tags: raw.map((t) => ({ id: String(t.id ?? t.tag_id ?? ""), name: String(t.name ?? ""), type: t.type ?? t.subtype })).filter((t) => t.id), request };
}

/** "/v2/insights?filter.type=urn:heatmap&signal.interests.entities=…" for logs and the how page. */
export function describeRequest(r: QlooRequest): string {
  const q = Object.entries(r.query)
    .map(([k, v]) => `${k}=${v.length > 60 ? `${v.slice(0, 57)}…` : v}`)
    .join("&");
  return `${r.path}?${q}`;
}
