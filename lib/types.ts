import type { RegionId } from "./geo/markets";

/** What someone asked for. */
export type TourInput = {
  artist: string;
  from: string;
  /** ISO date of the first show. */
  firstDate: string;
  shows: number;
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

export type Spot = { id: string; name: string; address?: string; affinity?: number };

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
  pitch?: Pitch;
};

export type AgeBucket = "24_and_younger" | "25_to_29" | "30_to_34" | "35_to_44" | "45_to_54" | "55_and_older";

export type Audience = {
  age: Partial<Record<AgeBucket, number>>;
  gender: { male?: number; female?: number };
  tags: { id: string; name: string; affinity?: number }[];
  trend: { date: string; percentile?: number; velocity?: number }[];
  brands: { id: string; name: string }[];
  /** All-ages / 18+ / 21+ advice derived from the age skew, by rule. */
  advice?: string;
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
};

export const TOUR_ID = /^[a-z0-9]{10}$/;

export function newTourId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
}
