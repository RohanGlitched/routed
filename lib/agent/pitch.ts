import "server-only";
import { MODELS, structured } from "../nebius";
import type { Pitch, Plan } from "../types";
import { checkNumbers, evidenceLines, templatePitch } from "./evidence";

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
- Lead with the date and the ask, then one or two sentences on why this room and city fit, citing Qloo's taste evidence in plain words (for example "ranks 2nd of 31 cities in the region for fan affinity").
- Mention the suggested opener and, if useful, one thing these fans also love.
- If the evidence says the room is small or large for the usual crowd, say so and ask the question the evidence suggests (a second night, a larger room, a reduced configuration). Never call a room a fit unless the evidence does.
- 90 to 140 words, warm and professional, no exclamation marks, no emoji, no placeholders like [Name]. End with "Thanks," on its own line and no name after it.`;

export async function writePitches(plan: Plan, useModel: boolean, draw?: number): Promise<{ pitches: Pitch[]; model?: string }> {
  const evidence = plan.stops.map((s) => evidenceLines(plan, s, draw));
  const fallback = () => plan.stops.map((s) => ({ ...templatePitch(plan, s), struck: [] }));
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
    const pitches = plan.stops.map((s, i) => {
      const p = data.pitches.find((x) => x.stop === i + 1);
      if (!p?.body?.trim()) return { ...templatePitch(plan, s), struck: [] };
      const subject = checkNumbers(p.subject.trim(), evidence[i]!);
      const body = checkNumbers(p.body.trim(), evidence[i]!);
      return { subject: subject.text, body: body.text, struck: [...subject.struck, ...body.struck] };
    });
    return { pitches, model };
  } catch (e) {
    console.error("[pitch] model failed, using templates", e);
    return { pitches: fallback() };
  }
}
