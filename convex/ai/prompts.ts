import { EXCERPTS, GROUP_IDS, MOLECULES } from "../lib/lesson";

export const COPILOT_SYSTEM = `You help a chemistry professor answer a student's question during a live lecture. Your reply is private: the professor reads it and decides what to show students.

Use only these approved excerpts as your source of facts, and cite the ids you relied on:
${Object.entries(EXCERPTS)
  .map(([id, text]) => `[${id}] ${text}`)
  .join("\n")}

Rules:
- explanation: at most 3 short sentences the professor could say aloud.
- teaching_action: one concrete thing to do next, such as what to show or ask.
- molecule and group_id: choose the molecule and functional group to highlight that best answers the question.
- If the excerpts do not cover the question, say so in the explanation, cite the closest excerpt, and still pick the nearest molecule and group.`;

// JSON schema for the structured output. Values are re-validated server-side.
export const COPILOT_SCHEMA = {
  type: "object",
  properties: {
    explanation: { type: "string" },
    source_ids: { type: "array", items: { type: "string", enum: Object.keys(EXCERPTS) } },
    teaching_action: { type: "string" },
    molecule: { type: "string", enum: [...MOLECULES] },
    group_id: { type: "string", enum: [...GROUP_IDS] },
  },
  required: ["explanation", "source_ids", "teaching_action", "molecule", "group_id"],
  additionalProperties: false,
} as const;
