"use client";

import { useEffect, useState } from "react";
import s from "./form.module.css";

/** Scrolls to the form and puts the cursor in the artist field. */
function goToForm(e?: React.MouseEvent) {
  const form = document.getElementById("route");
  if (!form) return;
  e?.preventDefault();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  form.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  form.querySelector<HTMLInputElement>('input[name="artist"]')?.focus({ preventScroll: true });
}

/**
 * On a phone the poster comes first and the form sits below it, so a "Route a tour" button sits right under the
 * poster, in the first screen. A plain link to #route, so it works before the page's script has loaded.
 * Hidden on wider screens, where the form is beside the poster.
 */
export function RouteJump() {
  return (
    <a href="#route" className={s.jump} id="route-jump" onClick={goToForm}>
      Route a tour
    </a>
  );
}

/**
 * Further down a phone page, a "Route a tour" bar stays at the bottom of the screen while neither the form nor the
 * button under the poster is in view. Hidden on wider screens (the form is above the fold there).
 */
export function StickyRoute() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const targets = [document.getElementById("route"), document.getElementById("route-jump")].filter((x): x is HTMLElement => Boolean(x));
    if (!targets.length || !("IntersectionObserver" in window)) return;
    const seen = new Map<Element, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target, e.isIntersecting);
        setShow(![...seen.values()].some(Boolean));
      },
      { threshold: 0.15 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  return (
    <div className={s.sticky} data-show={show ? "" : undefined} aria-hidden={!show}>
      <button type="button" onClick={() => goToForm()} tabIndex={show ? 0 : -1}>
        Route a tour
      </button>
    </div>
  );
}
