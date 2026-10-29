import Link from "next/link";
import { REPO_URL } from "@/lib/site";
import { CopyText } from "./CopyText";
import { Mark } from "./Mark";
import s from "./chrome.module.css";

/** The tour book the demo video opens; kept reachable under the same link. */
const FLAGSHIP = "/tour/8v4ce57nx6";
const VIDEO_URL = "https://youtu.be/Ck4u-36QRPY";
const MCP_URL = "https://routed-tours.vercel.app/api/mcp";

type Item = { href: string; label: string; note: string; external?: boolean };

const COLUMNS: { title: string; items: Item[] }[] = [
  {
    title: "Does Qloo help?",
    items: [
      { href: "/proof#unread", label: "Tours the model can't have read", note: "Real tours announced after its release" },
      { href: "/proof#head-to-head", label: "The head-to-head", note: "Older real tours, losses included" },
      { href: "/proof#own-ruler", label: "On Qloo's own ruler", note: "With and without Qloo, on each fan map" },
    ],
  },
  {
    title: "See it work",
    items: [
      { href: FLAGSHIP, label: "A finished tour book", note: "Sierra Ferrell, the tour in the video" },
      { href: VIDEO_URL, label: "The demo video", note: "A real run, start to finish", external: true },
      { href: "/#wall", label: "Poster wall", note: "Every tour, printed from its own run" },
    ],
  },
  {
    title: "How it works",
    items: [
      { href: "/how", label: "The agent and every Qloo call", note: "Requests and results from a real run" },
      { href: "/how#mcp", label: "Use it from your own agent", note: "Routed is an MCP server, five tools" },
      { href: `${REPO_URL}#what-routed-doesnt-know`, label: "What Routed doesn't know", note: "Known limits, in the README", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className={s.footer}>
      <div className={`wrap ${s.foot}`}>
        <div className={s.footTop}>
          <div className={s.footBrand}>
            <Link href="/" className={s.footLogo} aria-label="Routed, home">
              <Mark size={26} />
              <span>Routed</span>
            </Link>
            <p className={s.footPitch}>Tour where the fans are dense, not where the cities are big. Which city, which neighbourhood, which room, from Qloo&apos;s taste graph.</p>
            <Link href="/#route" className={s.footCta}>
              Route a tour
            </Link>
          </div>
          {COLUMNS.map((c) => (
            <nav key={c.title} className={s.footCol} aria-label={c.title}>
              <h2>{c.title}</h2>
              <ul>
                {c.items.map((i) => (
                  <li key={i.href}>
                    {i.external ? <a href={i.href}>{i.label}</a> : <Link href={i.href}>{i.label}</Link>}
                    <span>{i.note}</span>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className={s.footMcp}>
          <p>
            <b>MCP endpoint</b> for any assistant that takes remote MCP servers:
          </p>
          <CopyText text={MCP_URL} />
        </div>

        <div className={s.footBase}>
          <p className={s.credits}>
            Taste data from the <a href="https://www.qloo.com">Qloo</a> taste graph. Agent and pitches by NVIDIA Nemotron on Nebius Token Factory. Room capacities from <a href="https://www.wikidata.org">Wikidata</a> and the web (Tavily), each with its source. Cities from <a href="https://www.geonames.org">GeoNames</a> (CC BY 4.0); coastlines and borders from <a href="https://www.naturalearthdata.com">Natural Earth</a>, via us-atlas and world-atlas. Type: Big Shoulders and Schibsted Grotesk.
          </p>
          <p className={s.legal}>
            Open source on <a href={REPO_URL}>GitHub</a> under the <a href={`${REPO_URL}/blob/main/LICENSE`}>MIT licence</a>. Routed sends Qloo only public names and collects no personal data.
          </p>
        </div>
      </div>
    </footer>
  );
}
