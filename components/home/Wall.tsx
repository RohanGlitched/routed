"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Poster, type PosterProps } from "@/components/poster/Poster";
import s from "./wall.module.css";

/** `fanRank` is the cities' average rank on the artist's Qloo fan map, the one number on each card. */
export type WallEntry = { id: string; artist: string; from: string; fanRank: number; /** An arena run, shown last as a scale test. */ arena?: boolean };

/**
 * Columns that leave no hole in the last row: four when the count allows, else five or three; a count none of
 * them divides gets four and a short last row.
 */
function columns(n: number): { wide: number; mid: number } {
  const wide = n % 4 === 0 ? 4 : n % 5 === 0 ? 5 : n % 3 === 0 ? 3 : 4;
  return { wide, mid: n % 3 === 0 ? 3 : 2 };
}

/**
 * The poster wall. The page sends only the list (names and links, so it reads and links without script); the
 * posters' drawing data (about 25 KB each, 1,300 halftone dots apiece) comes from /api/wall, CDN-cached, once the
 * wall is within a screen of view, and each poster is drawn when it nears the viewport. Until then a blank sheet
 * holds its place, so nothing below it moves.
 */
export function Wall({ items }: { items: WallEntry[] }) {
  const ref = useRef<HTMLUListElement>(null);
  const [posters, setPosters] = useState<Record<string, PosterProps> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const load = () =>
      fetch("/api/wall")
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, PosterProps>>) : null))
        .then((j) => live && j && setPosters(j))
        .catch(() => {});
    if (!("IntersectionObserver" in window)) {
      load();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          load();
        }
      },
      { rootMargin: "900px 0px" },
    );
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, []);

  const cols = columns(items.length);
  return (
    <ul className={s.wall} ref={ref} style={{ "--cols": cols.wide, "--cols-mid": cols.mid } as React.CSSProperties}>
      {items.map((t) => (
        <li key={t.id}>
          <Link href={`/tour/${t.id}`} className={s.link}>
            <Sheet artist={t.artist} poster={posters?.[t.id]} />
            <span className={s.label}>
              <b>{t.artist}</b> from {t.from.split(",")[0]}
            </span>
            <span className={s.stat}>
              <b>#{Math.round(t.fanRank)}</b> average fan rank
            </span>
            {t.arena && <span className={s.scale}>Scale test: arena act</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One poster, drawn when it comes within half a screen of view, printing as it scrolls in (on a wide screen with
 *  motion allowed); a blank sheet with the artist's name before. */
function Sheet({ artist, poster }: { artist: string; poster?: PosterProps }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  return (
    <div ref={ref} className={s.sheet}>
      {poster && near ? (
        <Poster {...poster} compact print />
      ) : (
        <span className={s.blank} aria-hidden="true">
          {artist}
        </span>
      )}
    </div>
  );
}
