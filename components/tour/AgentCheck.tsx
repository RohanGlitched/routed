import Link from "next/link";
import type { AgentCheck as Check, LogLine } from "@/lib/types";
import { agentStory } from "./display";
import a from "./agent.module.css";

/** A re-run where the agent cleared check_plan's objections itself, linked from tours where it didn't. */
export type Rerun = { id: string; artist: string; before: number; rounds: number; date: string };

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join("; ")}; and ${xs.at(-1)}`);
const count = (n: number) => (n === 1 ? "one objection" : `${n} objections`);
const roundWord = (n: number) => (n === 1 ? "one round" : `${n} rounds`);

/**
 * The agent check in the tour book's head: the agent proposed, check_plan objected, each revision round, and how the
 * rules settled what was left. Read from the tour's own call sheet (display.ts agentStory), so no figure is typed.
 */
export function AgentCheck({ log, check, rerun }: { log: LogLine[]; check?: Check; rerun?: Rerun }) {
  const story = agentStory(log);
  if (!story || !check) return null;
  const left = story.rounds.at(-1)?.left ?? story.first;
  return (
    <section className={a.check} aria-labelledby="agent-check-title">
      <h2 id="agent-check-title" className={a.checkTitle}>
        The agent check
      </h2>
      <ol className={a.steps}>
        <li>
          <b>The agent proposed a booking</b>
          {story.first.length ? (
            <>
              {" "}
              and check_plan objected {story.first.length === 1 ? "once" : `${story.first.length} times`}: {list(story.first)}.
            </>
          ) : (
            <> and it cleared every rule.</>
          )}
        </li>
        {story.rounds.map((r) => (
          <li key={r.round}>
            <b>Round {r.round}:</b> the agent re-booked {r.picks}
            {r.left.length ? (
              <>
                , and {count(r.left.length)} stood: {list(r.left)}.
              </>
            ) : (
              <>, and every rule cleared.</>
            )}
          </li>
        ))}
        {story.first.length > 0 &&
          (story.cleared ? (
            <li className={a.stepDone}>
              <b>The agent cleared every objection itself</b>, in {roundWord(story.rounds.length)}.
              {story.settled.length ? ` Rules still sized the rooms after it: ${list(story.settled)}.` : ""}
            </li>
          ) : (
            <li className={a.stepRule}>
              <b>The rules settled {left.length === 1 ? "it" : `the ${left.length}`}</b>
              {check.ruled ? `, changing ${check.ruled} of ${check.stops} stops` : ""}
              {story.settled.length ? `: ${list(story.settled)}.` : "."}
            </li>
          ))}
      </ol>
      <p className={a.checkLinks}>
        <Link href="/how#agent-check">How the check works</Link>
        {rerun && !story.cleared ? (
          <>
            . On a re-run with the {rerun.date} loop the agent cleared its own:{" "}
            <Link href={`/tour/${rerun.id}`}>
              {rerun.artist}, {count(rerun.before)} to none in {roundWord(rerun.rounds)}
            </Link>
            .
          </>
        ) : (
          "."
        )}
      </p>
    </section>
  );
}
