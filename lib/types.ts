import type { RegionId } from "./geo/markets";

/** What someone asked for. */
export type TourInput = {
  artist: string;
  from: string;
  /** ISO date of the first show. */
  firstDate: string;
  shows: number;
  /** How many people the artist usually draws, when the person knows; rooms are sized to it. */
  draw?: number;
};

export type Artist = {
  id: string;
  name: string;
  image?: string;
  description?: string;
  disambiguation?: string;
  popularity?: number;
  genres: string[];
};

/** A market scored by Qloo's heatmap for this artist. `rank` is 1-based among the candidates. */
export type CityScore = {
  marketId: string;
  name: string;
  label: string;
  lat: number;
  lon: number;
  /** Highest tile affinity inside the market (0–1, relative within this one heatmap). */
  affinity: number;
  /** The tile's rank against the artist's own other tiles (0–1), when Qloo gives it. */
  affinityRank?: number;
  popularity?: number;
  tiles: number;
  rank: number;
};

export type Capacity = { value: number; source: string; quote: string };

export type Room = {
  id: string;
  name: string;
  address?: string;
  lat?: number;
  lon?: number;
  affinity?: number;
  popularity?: number;
  rating?: number;
  website?: string;
  image?: string;
  tags: string[];
  capacity?: Capacity;
};

export type Opener = {
  id: string;
  name: string;
  image?: string;
  affinity?: number;
  popularity?: number;
  description?: string;
  /** Concepts both audiences share, from Qloo's audience comparison, when it gives them. */
  shared: string[];
};

export type Spot = { id: string; name: string; address?: string; affinity?: number; kind?: string };

export type Pitch = { subject: string; body: string; struck: string[] };

export type Stop = {
  marketId: string;
  city: string;
  label: string;
  lat: number;
  lon: number;
  date: string;
  fromKm: number;
  fromHours: number;
  travelDays: number;
  dayOff: boolean;
  score: CityScore;
  /** The agent's one-line reason, checked like the pitch. */
  why?: string;
  rooms: Room[];
  roomId?: string;
  openers: Opener[];
  openerId?: string;
  /** Where the artist's fans go after a show here (cross-domain: artist → bars). */
  after: Spot[];
  /** Where a street team puts up posters: record stores, bookshops and cafés these fans go to (artist → shops). */
  posters?: Spot[];
  pitch?: Pitch;
};

export type AgeBucket = "24_and_younger" | "25_to_29" | "30_to_34" | "35_to_44" | "45_to_54" | "55_and_older";

/** A Qloo entity or tag by name, with this audience's affinity for it. */
export type Named = { id: string; name: string; affinity?: number; image?: string };

export type Audience = {
  age: Partial<Record<AgeBucket, number>>;
  gender: { male?: number; female?: number };
  /** Sound and mood together: the short list the agent and the pitches use. */
  tags: Named[];
  trend: { date: string; percentile?: number; velocity?: number }[];
  brands: Named[];
  /** Qloo taste analysis by kind: genres, how fans describe the music, themes, dishes. */
  taste?: { music?: Named[]; vibe?: Named[]; themes?: Named[]; food?: Named[] };
  /** Cross-domain: what else this audience loves. */
  media?: { podcasts?: Named[]; films?: Named[]; tv?: Named[]; books?: Named[] };
  /** All-ages / 18+ / 21+ advice derived from the age skew, by rule. */
  advice?: string;
};

/** One stop of the model-alone tour, scored on Qloo afterwards. */
export type GuessStop = {
  city: string;
  label: string;
  marketId?: string;
  /** The city's fan affinity on this artist's Qloo heatmap; undefined when the city had no tile at all. */
  affinity?: number;
  rank?: number;
  venue: string;
  venueId?: string;
  venueAffinity?: number;
};

/** The control group: the same model routing the same tour without Qloo, measured on Qloo's evidence. */
export type Guess = {
  model: string;
  stops: GuessStop[];
  cityMean: { routed?: number; guess?: number };
  /** Average rank among the region's cities on this artist's heatmap (1 = strongest); a city with no tile counts as last. */
  rankMean: { routed?: number; guess?: number };
  /** How many cities the heatmap ranked, for "#4 of 411". */
  ranked: number;
  roomMean: { routed?: number; guess?: number };
  /** Routed's rooms scored in the same Qloo call as the guessed ones. */
  routedRoomAffinity: Record<string, number>;
  /** Cities both tours share. */
  shared: number;
  /** Guessed cities that had no fan signal at all. */
  unscored: number;
};

export type Plan = {
  artist: Artist;
  region: RegionId;
  from: { marketId: string; label: string; lat: number; lon: number };
  firstDate: string;
  lastDate: string;
  heat: { lat: number; lon: number; affinity: number; popularity?: number }[];
  cities: CityScore[];
  stops: Stop[];
  totalKm: number;
  audience: Audience;
  guess?: Guess;
};

export type LogKind = "qloo" | "model" | "rule" | "web";

export type LogLine = {
  at: string;
  kind: LogKind;
  /** What was asked, in plain words ("Where do Japanese Breakfast fans over-index in North America?"). */
  text: string;
  /** What came back, in plain words ("48 tiles, 31 cities"). */
  result?: string;
  /** The exact request, for the curious (never the key). */
  request?: string;
  ms?: number;
  failed?: boolean;
};

export type Engine = { agent?: string; writer?: string; planned: "model" | "fixed" };

export type TourStatus = "queued" | "running" | "done" | "failed";

export type TourRecord = {
  id: string;
  createdAt: string;
  status: TourStatus;
  input: TourInput;
  startedAt?: string;
  finishedAt?: string;
  log: LogLine[];
  plan?: Plan;
  engine?: Engine;
  error?: string;
  showcase?: boolean;
  /** Part of the with/without-Qloo benchmark on /proof. */
  bench?: boolean;
};

export const TOUR_ID = /^[a-z0-9]{10}$/;

export function newTourId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
}
