"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CROWD_OPTIONS } from "@/lib/draw";
import s from "./form.module.css";

const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

type Left = { today: number; hour: number; limit?: "day" | "hour"; nextHour: string };
type Stored = { id: string; artist: string; match: "artist" | "nearest"; message: string };

/** How many new tours the Qloo allowance still covers, in a few words. */
function leftLine(l: Left): string {
  if (l.limit === "day") return "Today's Qloo allowance is spent: you'll get a stored tour instead, and new ones run again tomorrow.";
  if (l.limit === "hour") return `This hour's Qloo allowance is spent: you'll get a stored tour, and new ones run again at ${new Date(l.nextHour).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  const today = `${l.today} new tour${l.today === 1 ? "" : "s"} left today`;
  return l.hour < l.today ? `${today}, ${l.hour} this hour.` : `${today}.`;
}

/** The one form: who, from where, when, how many shows. Defaults let a first-time visitor just press the button. */
export function RouteForm({ artist = "", from = "", draw = "" }: { artist?: string; from?: string; draw?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [stored, setStored] = useState<Stored | null>(null);
  const [left, setLeft] = useState<Left | null>(null);
  const [crowd, setCrowd] = useState(draw);

  useEffect(() => {
    let live = true;
    fetch("/api/tours", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Left>) : null))
      .then((j) => live && j && typeof j.today === "number" && setLeft(j))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setStored(null);
    try {
      const r = await fetch("/api/tours", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artist: f.get("artist"), from: f.get("from"), firstDate: f.get("firstDate"), shows: Number(f.get("shows")), draw: Number(f.get("draw")) || undefined }),
      });
      const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string; field?: string; stored?: Stored };
      if (!r.ok || !j.id) throw Object.assign(new Error(j.error ?? "Couldn't start the routing. Try again."), { field: j.field });
      if (j.stored) {
        // The allowance is spent: say so and offer the stored tour, rather than opening it as if it were new.
        setStored({ ...j.stored, id: j.id });
        setBusy(false);
        return;
      }
      router.push(`/tour/${j.id}`);
    } catch (err) {
      setError({ text: (err as Error).message, field: (err as { field?: string }).field });
      setBusy(false);
    }
  }

  const bad = (f: string) => (error?.field === f ? { "aria-invalid": true, "aria-describedby": "route-error" } : {});
  const options: readonly number[] = CROWD_OPTIONS;

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
        <select name="draw" value={options.includes(Number(crowd)) ? crowd : ""} onChange={(e) => setCrowd(e.target.value)} {...(crowd ? {} : { "aria-describedby": "draw-note" })} {...bad("draw")}>
          <option value="">Not sure</option>
          {options.map((n) => (
            <option key={n} value={n}>
              About {n.toLocaleString("en-US")}
            </option>
          ))}
        </select>
      </label>
      {!crowd && (
        <p className={s.drawNote} id="draw-note">
          Not sure? Routed assumes a crowd from the artist&apos;s Qloo popularity and prints it on the tour, so you can change it.
        </p>
      )}
      <div className={s.actions}>
        <button type="submit" disabled={busy}>
          {busy ? "Starting the agent…" : "Route the tour"}
        </button>
        <p className={s.hint} aria-live="polite">
          About a minute. No sign-up.{left ? ` ${leftLine(left)}` : ""}
        </p>
      </div>
      {error && (
        <p className={s.error} id="route-error" role="alert">
          {error.text}
        </p>
      )}
      {stored && (
        <div className={s.stored} role="status">
          <p>{stored.message}</p>
          <Link href={`/tour/${stored.id}`} className={s.storedLink}>
            Open the stored {stored.artist} tour
          </Link>
        </div>
      )}
    </form>
  );
}
