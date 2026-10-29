import { displayTag } from "@/lib/tags";
import type { Named, Plan } from "@/lib/types";
import c from "./campaign.module.css";

/**
 * Beyond the room: what the rest of Qloo's graph says about this audience, turned into the jobs around a tour.
 * Each block is one Qloo ranking (podcasts, brands, mood, films, TV, books, genres) with what it's for; the
 * lists are Qloo's, in Qloo's order, never written by the model.
 */
export function Campaign({ plan }: { plan: Plan }) {
  const a = plan.audience;
  const t = a.taste ?? {};
  const m = a.media ?? {};
  const artist = plan.artist.name;
  const blocks: { key: string; title: string; use: string; items: Named[]; wide?: boolean }[] = [
    { key: "press", title: "Press", use: `Podcasts ${artist} fans over-index on: pitch an interview or a tour episode to these first.`, items: m.podcasts ?? [] },
    { key: "partners", title: "Partners and merch", use: "Brands this audience over-indexes on: co-branded merch, a sponsored night, or a giveaway at the door.", items: a.brands },
    { key: "brief", title: "Creative brief", use: "The words these fans use for the music they love: the tone for the poster, the ads and the setlist talk.", items: (t.vibe ?? []).slice(0, 8) },
    { key: "screen", title: "Watch and read", use: "Films, TV and books this audience loves: references for content, playlists between sets and screening tie-ins.", items: [...(m.films ?? []).slice(0, 3), ...(m.tv ?? []).slice(0, 3), ...(m.books ?? []).slice(0, 2)] },
    { key: "sound", title: "The sound", use: "Genres this audience over-indexes on: how to describe the night to a talent buyer and which local acts to add.", items: t.music ?? [] },
  ].filter((b) => b.items.length > 0);
  if (!blocks.length) return null;

  return (
    <section className={c.campaign} aria-labelledby="campaign-title">
      <div className={c.head}>
        <h2 id="campaign-title" className={c.h2}>
          Beyond the room
        </h2>
        <p className={c.lede}>
          The same audience across the rest of Qloo&apos;s graph: what {artist} fans listen to, buy, watch and read, ranked by how much more they love it than the average Qloo user. Each list is Qloo&apos;s own ranking.
        </p>
      </div>
      <div className={c.grid}>
        {blocks.map((b) => (
          <article key={b.key} className={c.block}>
            <h3>{b.title}</h3>
            <p className={c.use}>{b.use}</p>
            <ol className={c.items}>
              {b.items.slice(0, 8).map((x) => (
                <li key={x.id}>
                  <span>{b.key === "brief" || b.key === "sound" ? displayTag(x.name) : x.name}</span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
