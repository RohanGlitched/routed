import Link from "next/link";
import { REPO_URL } from "@/lib/site";
import { Mark } from "./Mark";
import s from "./chrome.module.css";

export function Footer() {
  return (
    <footer className={s.footer}>
      <div className={`wrap ${s.foot}`}>
        <div className={s.footBrand}>
          <Mark size={22} />
          <span>Routed</span>
        </div>
        <p className={s.credits}>
          Taste data from <a href="https://www.qloo.com">Qloo</a>. Agent and pitches by NVIDIA Nemotron on Nebius Token Factory. Room capacities from the web via Tavily, with their source. Cities from{" "}
          <a href="https://www.geonames.org">GeoNames</a> (CC BY 4.0); coastlines from Natural Earth.
        </p>
        <nav className={s.footNav} aria-label="Footer">
          <Link href="/how">How it works</Link>
          <a href={REPO_URL}>Source code</a>
        </nav>
      </div>
    </footer>
  );
}
