import Link from "next/link";
import { Mark } from "./Mark";
import s from "./chrome.module.css";

export function Header() {
  return (
    <header className={s.header}>
      <div className={`wrap ${s.bar}`}>
        <Link href="/" className={s.logo} aria-label="Routed, home">
          <Mark />
          <span>Routed</span>
        </Link>
        <nav className={s.nav} aria-label="Main">
          <Link href="/#route">Route a tour</Link>
          <Link href="/#wall">Poster wall</Link>
          <Link href="/how">How it works</Link>
        </nav>
      </div>
    </header>
  );
}
