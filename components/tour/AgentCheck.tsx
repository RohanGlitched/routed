import Link from "next/link";
import type { AgentCheck as Check, LogLine, Stop } from "@/lib/types";
import { agentStory, swapRows, type SwapRow } from "./display";
import a from "./agent.module.css";

/** A re-run where the agent cleared check_plan's objections itself, linked from tours where it didn't. */
export type Rerun = {
  id: string;
  artist: string;
  before: number;
  rounds: number;
  date: string;
  /** check_plan's first objections there, in the tour book's words (display.ts agentStory). */
  first?: string[];
  /** Its call-sheet rows (display.ts swapRows): proposed, objected, re-chose, booked. */
  rows?: SwapRow[];
};

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join("; ")}; and ${xs.at(-1)}`);
const count = (n: number) => (n === 1 ? "one objection" : `${n} objections`);
const roundWord = (n: number) => (n === 1 ? "one round" : `${n} rounds`);

/**
 * The agent check in the tour book's head. It opens on the same table as the deck's call sheet (display.ts
 * swapRows): what the agent proposed, what check_plan objected, what it re-chose and what was booked. Each round
 * in full sits behind "Show all rounds", and two lines link the loop where the agent cleared its own and the same
 * artist re-run with the current loop. Read from the tour's own call sheet, so no figure is typed.
 */
export function AgentCheck({ log, check, stops, rerun, same }: { log: LogLine[]; check?: Check; stops: Stop[]; rerun?: Rerun; same?: Rerun & { after: number; scout: number } }) {
  const story = agentStory(log);
  if (!story || !check) return null;
  const left = story.rounds.at(-1)?.left ?? story.first;
  const rows = swapRows(log, stops);
  return (
    <section className={a.check} aria-labelledby="agent-check-title">
      <h2 id="agent-check-title" className={a.checkTitle}>
        The agent check
      </h2>
      <p className={a.checkLead}>
        {story.first.length ? `The agent proposed a booking and check_plan objected ${story.first.length === 1 ? "once" : `${story.first.length} times`}` : "The agent proposed a booking and it cleared every rule"}
        {story.rounds.length ? `; the agent re-booked over ${roundWord(story.rounds.length)}` : ""}
        {story.first.length ? (story.cleared ? ", clearing every objection itself." : `; the rules settled ${left.length === 1 ? "the last one" : `the last ${left.length}`}${check.ruled ? `, changing ${check.ruled} of ${check.stops} stops` : ""}.`) : "."}
      </p>
      {rows.length > 0 && (
        <div className={a.checkTableBox}>
          <table className={a.checkTable}>
            <thead>
              <tr>
                <th scope="col">Proposed</th>
                <th scope="col">Objected</th>
                <th scope="col">Re-chose</th>
                <th scope="col">Booked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>
                  <td data-label="Proposed">
                    <span className={a.proposed}>{r.proposed}</span>
                  </td>
                  <td data-label="Objected">{r.objection}</td>
                  <td data-label="Re-chose" className={a.chose}>
                    {r.chose}
                  </td>
                  <td data-label="Booked" className={a.checkBooked}>
                    <b>{r.booked}</b>
                    {r.rule && <span>By rule: {r.rule}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className={a.rounds}>
        <summary>Show all rounds</summary>
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
      </details>
      {rerun && !story.cleared ? (
        <p className={a.checkLinks}>
          A loop where the agent cleared its own:{" "}
          <Link href={`/tour/${rerun.id}`}>
            {rerun.artist}, {count(rerun.before)} to none in {roundWord(rerun.rounds)} ({rerun.date})
          </Link>
          .
        </p>
      ) : null}
      {same ? (
        <p className={a.checkLinks}>
          Same artist on the current loop:{" "}
          <Link href={`/tour/${same.id}`}>
            the agent cleared {same.before - same.after} of {same.before} itself ({same.date})
          </Link>
          {same.after ? (same.after === same.before ? ", and the rules settled them" : `, and the rules settled ${same.after === 1 ? "the other" : `the other ${same.after}`}`) : ""}
          {same.scout ? `; it asked to scout ${same.scout === 1 ? "once" : `${same.scout} times`}` : ""}. This tour stays as the demo video shows it.
        </p>
      ) : null}
      <p className={a.checkLinks}>
        <Link href="/how#agent-check">How the check works</Link>.
      </p>
    </section>
  );
}
