import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap" style={{ paddingTop: "12vh", paddingBottom: "8vh" }}>
      <p style={{ fontFamily: "var(--wood)", fontWeight: 900, fontSize: "clamp(96px, 16vw, 200px)", lineHeight: 0.85, color: "var(--fire)", margin: 0 }}>NO SHOW</p>
      <h1 style={{ fontSize: 28, margin: "18px 0 8px" }}>There&apos;s nothing booked at this address.</h1>
      <p style={{ color: "var(--ink-2)", margin: "0 0 24px" }}>The link may be mistyped, or the tour was never routed.</p>
      <Link href="/" style={{ fontWeight: 700 }}>
        Route a tour
      </Link>
    </div>
  );
}
