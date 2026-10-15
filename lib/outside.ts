import raw from "../data/real-tours.json";
import { findMarket, marketId, nearestMarket, type RegionId } from "./geo/markets";

/**
 * The outside check: a ruler Qloo didn't make. For each benchmark artist, the cities of one recent headline tour
 * they actually announced and played (from Wikipedia tour articles, press listings and label releases, every
 * source linked in data/real-tours.json; festivals, support slots and in-stores left out), placed on the same
 * touring markets. Both tours, Routed's and the model alone's, are counted against it: how many of the cities
 * each booked did the artist really play? It isn't proof of the best route (an artist's past tour is one
 * booker's choice, made with ticket data neither side has), and the model alone may have read these announcements,
 * which favours it. That's why it's here.
 */

export type RealTour = {
  artist: string;
  region: RegionId;
  found: boolean;
  tour?: string;
  year?: string;
  cities: string[];
  /** Approximate coordinates for suburbs and venue towns that aren't touring markets by name. */
  at?: Record<string, [number, number]>;
  sources: string[];
  note?: string;
};

export const REAL_TOURS = raw as RealTour[];

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

export function realTourFor(artist: string): RealTour | undefined {
  return REAL_TOURS.find((t) => t.found && fold(t.artist) === fold(artist));
}

/** The touring markets a real tour played: by name, else the nearest market within 60 km of the town. */
export function realMarkets(t: RealTour): Set<string> {
  const out = new Set<string>();
  for (const c of t.cities) {
    const byName = findMarket(c, t.region);
    const at = t.at?.[c];
    const m = byName ?? (at ? nearestMarket({ lat: at[0], lon: at[1] }, t.region, 60) : null);
    if (m) out.add(marketId(m));
  }
  return out;
}

export type OutsideRow = {
  artist: string;
  tour: string;
  year?: string;
  played: number;
  routed: { hits: number; of: number; cities: string[] };
  guess: { hits: number; of: number; cities: string[] };
  sources: string[];
};

/** Counts how many of each tour's cities the artist really played. Model-alone stops that couldn't be placed are left out. */
export function outsideRow(t: RealTour, routed: { marketId: string; city: string }[], guess: { marketId?: string; city: string }[]): OutsideRow {
  const played = realMarkets(t);
  const hit = <T extends { marketId?: string; city: string }>(xs: T[]) => {
    const placed = xs.filter((x) => x.marketId);
    const got = placed.filter((x) => played.has(x.marketId!));
    return { hits: got.length, of: placed.length, cities: got.map((x) => x.city) };
  };
  return { artist: t.artist, tour: t.tour ?? "", year: t.year, played: played.size, routed: hit(routed), guess: hit(guess), sources: t.sources };
}
