"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import s from "./form.module.css";

const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** The one form: who, from where, when, how many shows. Defaults let a first-time visitor just press the button. */
export function RouteForm({ artist = "", from = "" }: { artist?: string; from?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/tours", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artist: f.get("artist"), from: f.get("from"), firstDate: f.get("firstDate"), shows: Number(f.get("shows")), draw: Number(f.get("draw")) || undefined }),
      });
      const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string; field?: string };
      if (!r.ok || !j.id) throw Object.assign(new Error(j.error ?? "Couldn't start the routing. Try again."), { field: j.field });
      router.push(`/tour/${j.id}`);
    } catch (err) {
      setError({ text: (err as Error).message, field: (err as { field?: string }).field });
      setBusy(false);
    }
  }

  const bad = (f: string) => (error?.field === f ? { "aria-invalid": true, "aria-describedby": "route-error" } : {});

  return (
    <form className={s.form} onSubmit={submit} id="route" noValidate>
      <label className={s.full}>
        <span>Artist</span>
        <input name="artist" required defaultValue={artist} placeholder="Who's going on tour?" autoComplete="off" {...bad("artist")} />
      </label>
      <label>
        <span>Starting from</span>
        <input name="from" required defaultValue={from} placeholder="City" autoComplete="address-level2" {...bad("from")} />
      </label>
      <label>
        <span>First show</span>
        <input name="firstDate" type="date" required defaultValue={plusDays(150)} min={plusDays(1)} suppressHydrationWarning {...bad("firstDate")} />
      </label>
      <label className={s.shows}>
        <span>Shows</span>
        <select name="shows" defaultValue="10" {...bad("shows")}>
          {Array.from({ length: 14 }, (_, i) => i + 3).map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <label className={s.draw}>
        <span>Usual crowd</span>
        <select name="draw" defaultValue="" {...bad("draw")}>
          <option value="">Not sure</option>
          {[150, 300, 600, 1000, 1500, 2500, 4000, 7000, 12000].map((n) => (
            <option key={n} value={n}>
              About {n.toLocaleString("en-US")}
            </option>
          ))}
        </select>
      </label>
      <div className={s.actions}>
        <button type="submit" disabled={busy}>
          {busy ? "Starting the agent…" : "Route the tour"}
        </button>
        <p className={s.hint}>About a minute. No sign-up.</p>
      </div>
      {error && (
        <p className={s.error} id="route-error" role="alert">
          {error.text}
        </p>
      )}
    </form>
  );
}
