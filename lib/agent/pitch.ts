import "server-only";
import { MODELS, structured } from "../nebius";
import type { Pitch, Plan } from "../types";
import { buyerBlock, checkNumbers, evidenceLines, falseLocalClaim, garbled, signed, stopLocal, templatePitch, withBuyerBlock } from "./evidence";

/**
 * One hold-request email per stop, written by Nemotron from that stop's evidence lines only, as strict JSON.
 * Every number in the result is checked against the evidence and any that isn't there is struck, visibly.
 * Without the model, a plain template from the same evidence.
 */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pitches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { stop: { type: "integer" }, subject: { type: "string" }, body: { type: "string" } },
        required: ["stop", "subject", "body"],
      },
    },
  },
  required: ["pitches"],
};

const SYSTEM = `You write short hold-request emails from an independent artist's booking agent to a venue's talent buyer.
Rules:
- Use only the facts in that stop's evidence. Never invent ticket sales, streams, follower counts, prices, guarantees or past shows.
- Subject: "Hold request: <artist>, <city>, <date with weekday, month, day and year>".
- Open with the ask: a 1st hold on the date (both dates for two nights), or a 2nd hold if it is taken.
- Give the routing in one line, in and out, as the evidence's Routing line says.
- Say what the room holds against the usual crowd, as the evidence words it. Never call a room a fit unless the evidence does; if it says the room is small or large, ask the question it suggests (a second night, a larger room, a reduced configuration).
- Exactly one line of Qloo evidence, the city's rank (for example "Qloo ranks it #2 of 31 cities in the region for her fans"). No heatmap blocks, tiles, neighbourhood distances or scores out of 100 for the city, and don't state ages as fact.
- Name the support act (the same one plays the whole run), with its score only as "a N/100 audience match on Qloo" if at all, never "ranked N" and never shared affinity or overlap. Name a genre for the bill only if the evidence says both acts are filed under it.
- Ask for availability and their offer. Don't write ticket prices, deal terms or set lengths: a block of fields for those is added under your email.
- 60 to 110 words, warm and professional, written for a busy talent buyer, no exclamation marks, no emoji, no placeholders like [Name]. End with "Thanks," on its own line and no name after it.`;

/**
 * The hold requests for a plan. A pitch the model wrote that reads as broken (a repeated run of words, a cut-off
 * word: garbled in evidence.ts) is replaced by the template, as is a missing one. `sign` (the agent's name and
 * agency, when the form gives one) goes under "Thanks," on every pitch, added here rather than by the model.
 */
export async function writePitches(plan: Plan, useModel: boolean, draw?: number, sign?: string): Promise<{ pitches: Pitch[]; model?: string }> {
  const evidence = plan.stops.map((s) => evidenceLines(plan, s, draw));
  const template = (i: number) => ({ ...templatePitch(plan, plan.stops[i]!, { draw, sign }), struck: [] });
  const fallback = () => plan.stops.map((_, i) => template(i));
  if (!useModel) return { pitches: fallback() };
  try {
    const { data, model } = await structured<{ pitches: { stop: number; subject: string; body: string }[] }>(MODELS.writer, {
      name: "pitches",
      schema: SCHEMA,
      maxTokens: 6000,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Write one email per stop.\n\n${evidence.map((lines, i) => `Stop ${i + 1}\n${lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n")}` },
      ],
    });
    const pitches = plan.stops.map((_, i) => {
      const p = data.pitches.find((x) => x.stop === i + 1);
      if (!p?.body?.trim() || garbled(`${p.subject}\n${p.body}`).length || falseLocalClaim(`${p.subject}\n${p.body}`, stopLocal(plan.stops[i]!))) return template(i);
      const subject = checkNumbers(p.subject.trim(), evidence[i]!);
      const body = checkNumbers(p.body.trim(), evidence[i]!);
      return { subject: subject.text, body: signed(withBuyerBlock(body.text, buyerBlock(plan, plan.stops[i]!)), sign), struck: [...subject.struck, ...body.struck] };
    });
    return { pitches, model };
  } catch (e) {
    console.error("[pitch] model failed, using templates", e);
    return { pitches: fallback() };
  }
}
