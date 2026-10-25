import Link from "next/link";
import s from "./form.module.css";

/**
 * "Assumed about 1,500; change it": printed on a tour whose crowd was left at "Not sure", so the visitor sees the
 * crowd the rooms were sized to and can re-route with their own. The link reopens the form with the artist,
 * starting city and the assumed crowd filled in. Works in server and client components.
 */
export function AssumedDraw({ draw, artist, from }: { draw: number; artist: string; from: string }) {
  const q = new URLSearchParams({ artist, from, draw: String(draw) });
  return (
    <p className={s.assumed}>
      <b>Assumed about {draw.toLocaleString("en-US")}; </b>
      <Link href={`/?${q}#route`}>change it</Link>. The usual crowd was left at &ldquo;Not sure&rdquo;, so Routed read it from {artist}&apos;s Qloo popularity and sized every room to it.
    </p>
  );
}
