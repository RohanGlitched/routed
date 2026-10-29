"use client";

import { useState } from "react";
import s from "./chrome.module.css";

/** A value to paste somewhere else (the MCP endpoint), selectable as text, with a copy button once script runs. */
export function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      setDone(false);
    }
  }

  return (
    <div className={s.copy}>
      <span className={s.copyText}>{text}</span>
      <button type="button" onClick={copy} aria-live="polite">
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
