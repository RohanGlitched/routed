import { test } from "node:test";
import assert from "node:assert/strict";
import { roomNameMatches } from "../lib/agent/plan.ts";
import { lineContext, readLine } from "../lib/log.ts";
import { agentStory, objectionPhrase } from "../components/tour/display.ts";
import type { LogLine } from "../lib/types.ts";

const cap = (value: number, checked = true) => ({ value, source: "https://example.org", quote: checked ? "holds it (checked by hand Oct 30)" : "a listing" });
const plan = {
  stops: [
    { city: "Portland", roomId: "p1", rooms: [{ id: "p1", name: "McMenamins Crystal Ballroom", capacity: cap(1500) }, { id: "p2", name: "Wonder Ballroom", capacity: cap(778, false) }] },
    { city: "Cincinnati", roomId: "c1", rooms: [{ id: "c1", name: "Bogart's", capacity: cap(1500) }, { id: "c2", name: "Madison Theater", capacity: cap(1200) }] },
  ],
};
const ctx = lineContext(plan, (a, b) => roomNameMatches(a, b))!;
const line = (kind: LogLine["kind"], text: string, result?: string, extra: Partial<LogLine> = {}): LogLine => ({ at: "2026-10-25T08:58:55Z", kind, text, ...(result ? { result } : {}), ...extra });

test("a room the agent named that the city's list held under an operator's name reads as found, not missing", () => {
  const l = readLine(line("qloo", "The agent suggested Crystal Ballroom in Portland; Qloo has no such room here.", undefined, { failed: true }), ctx);
  assert.equal(l.text, "The agent suggested Crystal Ballroom in Portland; found on Qloo as McMenamins Crystal Ballroom, and booked.");
  assert.equal(l.failed, undefined);
  // Without the plan (the browser's own pass, an old caller) the line keeps the Oct 30 wording.
  assert.match(readLine(line("qloo", "The agent suggested Crystal Ballroom in Portland; Qloo has no such room here.")).text, /didn't return it there/);
  // A room nobody listed stays not booked.
  assert.match(readLine(line("qloo", "The agent suggested Revolution Hall in Portland; Qloo has no such room here."), ctx).text, /didn't return it there, so it isn't booked/);
});

test("a web capacity the hand check overturned is marked; one it agrees with, or an unchecked room, is not", () => {
  const wrong = readLine(line("web", "How many does Madison Theater hold?", "17,556, per nederlanderentertainment.com"), ctx);
  assert.deepEqual(wrong.check, { wrong: true, text: "Rejected: wrong for this room; the hand-checked figure is about 1,200." });
  const close = readLine(line("web", "How many does Bogart's hold?", "1,200, per eventective.com"), ctx);
  assert.deepEqual(close.check, { wrong: false, text: "The hand-checked figure, about 1,500, replaces it." });
  assert.equal(readLine(line("web", "How many does McMenamins Crystal Ballroom hold?", "1,500, per en.wikipedia.org"), ctx).check, undefined);
  assert.equal(readLine(line("web", "How many does Wonder Ballroom hold?", "900, per example.org"), ctx).check, undefined);
  // An objection that rested on the wrong figure says so.
  const round = readLine(line("model", "The agent re-booked after the check (round 1 of 2).", "2 picks changed; 1 objection left: Cincinnati: Madison Theater holds 17,556, too big", { swaps: [{ proposed: "Madison Theater, Cincinnati", objection: "Madison Theater holds 17,556, too big", chose: "Taft Theatre" }] }), ctx);
  assert.match(round.result!, /Madison Theater holds 17,556, too big \(a web figure, hand-checked at about 1,200\)/);
  assert.match(round.swaps![0]!.objection, /hand-checked at about 1,200/);
});

test("the agent check reads as proposed, objected, each round, settled", () => {
  const log = [
    line("rule", "check_plan: 3 objections to the agent's booking, sent back to it.", "Cincinnati: not one of the city's rooms; Louisville: 145 km from Cincinnati (radius clause); Portland: 1,895 km leg from Denver"),
    line("model", "The agent re-booked after the check (round 1 of 2).", "2 picks changed; 1 objection left: Cincinnati: Madison Theater holds 17,556, too big (a web figure, hand-checked at about 1,200)"),
    line("model", "The agent re-booked after the check (round 2 of 2).", "3 picks changed; 2 objections left: Salt Lake City: not one of the city's rooms; Denver: 2,107 km leg from Cincinnati"),
    line("rule", "2 objections still stand after the agent's 2 revisions, so the rules settle them."),
    line("rule", "Austin would cost a 1,841 km leg with no show, so Memphis (#18 on the fan map) takes its place."),
    line("rule", "Taft Theatre holds 2,500, a loose fit for a crowd of about 1,500, and Bogart's is closer, so Cincinnati gets Bogart's.", "Bogart's holds 1,200"),
    line("rule", "One support act for the whole run: Kelsey Waldon."),
    line("rule", "The agent's room couldn't be confirmed for the crowd, so Nowhere gets Somewhere."),
  ];
  const s = agentStory(log)!;
  assert.deepEqual(s.first, ["Cincinnati's room wasn't one Qloo lists there", "Louisville sat inside Cincinnati's radius (145 km)", "a 1,895 km leg from Denver to Portland"]);
  assert.deepEqual(s.rounds.map((r) => [r.round, r.picks, r.left.length]), [[1, "2 picks", 1], [2, "3 picks", 2]]);
  assert.equal(s.rounds[0]!.left[0], "Madison Theater too big for Cincinnati, on a wrong web figure of 17,556 (hand-checked about 1,200)");
  assert.equal(s.cleared, false);
  // Settled up to the support-act line, not after it.
  assert.deepEqual(s.settled, ["Memphis (fan #18) replaced Austin, which would have needed a 1,841 km leg with no show", "Cincinnati gets Bogart's"]);
  assert.equal(agentStory([line("rule", "check_plan: one objection to the agent's booking, sent back to it.", "Vancouver: 3,551 km leg from Chicago"), line("model", "The agent re-booked after the check (round 1 of 3).", "1 pick changed; every rule clears")])!.cleared, true);
  assert.equal(agentStory([line("rule", "Booked.")]), null);
  assert.equal(objectionPhrase("Chicago: Chicago is a major market, #8 (anchor rule)"), "Chicago missing, a major market and fan city #8");
});
