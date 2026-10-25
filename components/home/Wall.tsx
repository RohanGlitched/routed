"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Poster, type PosterProps } from "@/components/poster/Poster";
import s from "./wall.module.css";

export type WallEntry = { id: string; artist: string; shows: number; from: string };

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

  return (
    <ul className={s.wall} ref={ref}>
      {items.map((t) => (
        <li key={t.id}>
          <Link href={`/tour/${t.id}`} className={s.link}>
            <Sheet artist={t.artist} poster={posters?.[t.id]} />
            <span>
              {t.artist}, {t.shows} cities from {t.from.split(",")[0]}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One poster, drawn when it comes within half a screen of view; a blank sheet with the artist's name before. */
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
        <Poster {...poster} compact />
      ) : (
        <span className={s.blank} aria-hidden="true">
          {artist}
        </span>
      )}
    </div>
  );
}
