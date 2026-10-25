import Link from "next/link";
import { Mark } from "./Mark";
import s from "./chrome.module.css";

const NAV: [href: string, long: string, short: string][] = [
  ["/#route", "Route a tour", "Route"],
  ["/#wall", "Poster wall", "Wall"],
  ["/proof", "With and without Qloo", "Proof"],
  ["/how", "How it works", "How"],
];

export function Header() {
  return (
    <header className={s.header}>
      <div className={`wrap ${s.bar}`}>
        <Link href="/" className={s.logo} aria-label="Routed, home">
          <Mark />
          <span>Routed</span>
        </Link>
        <nav className={s.nav} aria-label="Main">
          {/* Phones get the short label of each, so the four fit on one line with the mark. */}
          {NAV.map(([href, long, short]) => (
            <Link key={href} href={href}>
              <span className={s.long}>{long}</span>
              <span className={s.short}>{short}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
