"use client";

import { useEffect, useState } from "react";
import s from "./form.module.css";

/**
 * On a phone the poster comes first and the form sits below the fold, so a "Route a tour" bar stays at the bottom
 * of the screen until the form is in view; it scrolls to the form and puts the cursor in the artist field.
 * Hidden on wider screens (the form is above the fold there) and whenever the form is on screen.
 */
export function StickyRoute() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const form = document.getElementById("route");
    if (!form || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => setShow(!entries.some((e) => e.isIntersecting)), { threshold: 0.15 });
    io.observe(form);
    return () => io.disconnect();
  }, []);

  function go() {
    const form = document.getElementById("route");
    if (!form) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    form.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    form.querySelector<HTMLInputElement>('input[name="artist"]')?.focus({ preventScroll: true });
  }

  return (
    <div className={s.sticky} data-show={show ? "" : undefined} aria-hidden={!show}>
      <button type="button" onClick={go} tabIndex={show ? 0 : -1}>
        Route a tour
      </button>
    </div>
  );
}
