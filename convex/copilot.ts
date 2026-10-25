import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { COPILOT_SCHEMA, COPILOT_SYSTEM } from "./ai/prompts";
import { requireProfessor } from "./lib/auth";
import { fetchHighlight } from "./lib/chem";
import {
  EXCERPTS,
  GROUP_IDS,
  MOLECULES,
  pickFallback,
  type Suggestion,
} from "./lib/lesson";

const MODEL = "claude-sonnet-5-5";
const CLAUDE_TIMEOUT_MS = 10000;

export const getContext = internalQuery({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    questionId: v.id("questions"),
  },
  handler: async (ctx, args) => {
    const session = await requireProfessor(ctx, args.sessionId, args.token);
    const question = await ctx.db.get(args.questionId);
    if (question === null || question.sessionId !== args.sessionId) {
      throw new ConvexError("Question not found");
    }
    const recent = await ctx.db
      .query("questions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(6);
    return {
      topic: session.topic,
      question: question.text,
      recentQuestions: recent
        .filter((q) => q._id !== question._id)
        .slice(0, 5)
        .map((q) => q.text),
    };
  },
});

export const save = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    questionId: v.id("questions"),
    explanation: v.string(),
    sourceIds: v.array(v.string()),
    teachingAction: v.string(),
    molecule: v.optional(v.string()),
    groupId: v.optional(v.string()),
    previewId: v.optional(v.id("previews")),
    note: v.optional(v.string()),
    cached: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("suggestions", args);
  },
});

export const listForProfessor = query({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    return await ctx.db
      .query("suggestions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(50);
  },
});

class ClaudeTimeout extends Error { }

// One structured-output call. Throws ClaudeTimeout when it exceeds the
// time budget; any other failure (API error, bad output) is a plain Error.
async function askClaude(input: {
  topic: string;
  question: string;
  recentQuestions: string[];
}): Promise<Suggestion> {
  const client = new Anthropic({ maxRetries: 0, timeout: CLAUDE_TIMEOUT_MS });
  const recent = input.recentQuestions.length
    ? input.recentQuestions.map((q) => `- ${q}`).join("\n")
    : "(none)";

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: COPILOT_SYSTEM,
      // Thinking off and low effort keep this inside the 3s budget.
      thinking: { type: "between_tools" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: COPILOT_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `Lecture topic: ${input.topic}\nRecent student questions:\n${recent}\n\nStudent question: ${input.question}`,
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      throw new ClaudeTimeout();
    }
    throw err;
  }

  const block = response.content.find((b) => b.type === "text");
  if (response.stop_reason !== "end_turn" || block?.type !== "text") {
    throw new Error(`Unusable response (${response.stop_reason})`);
  }
  return validate(JSON.parse(block.text));
}

// The schema constrains the output, but we still check it: a citation we
// don't hold or a group we don't support must never reach the professor.
function validate(raw: unknown): Suggestion {
  const o = raw as Record<string, unknown>;
  const sourceIds = o.source_ids;
  if (
    typeof o.explanation !== "string" ||
    typeof o.teaching_action !== "string" ||
    typeof o.molecule !== "string" ||
    typeof o.group_id !== "string" ||
    !Array.isArray(sourceIds) ||
    !sourceIds.every((id) => typeof id === "string" && id in EXCERPTS) ||
    !(MOLECULES as readonly string[]).includes(o.molecule) ||
    !(GROUP_IDS as readonly string[]).includes(o.group_id)
  ) {
    throw new Error("Output failed validation");
  }
  return {
    explanation: o.explanation,
    sourceIds: sourceIds as string[],
    teachingAction: o.teaching_action,
    molecule: o.molecule,
    groupId: o.group_id,
  };
}

// Private copilot answer for one question. Retries once on a fast failure,
// never after a timeout; if Claude can't answer in time, falls back to a
// canned suggestion marked as cached.
export const suggest = action({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    questionId: v.id("questions"),
  },
  handler: async (ctx, args): Promise<Id<"suggestions">> => {
    const info = await ctx.runQuery(internal.copilot.getContext, args);

    let suggestion: Suggestion | null = null;
    let cached = false;
    let claudeNote: string | undefined;
    for (let attempt = 0; attempt < 2 && suggestion === null; attempt++) {
      try {
        suggestion = await askClaude(info);
      } catch (err) {
        if (err instanceof ClaudeTimeout) {
          claudeNote = `Claude timed out after ${CLAUDE_TIMEOUT_MS / 1000}s`;
          break;
        }
        claudeNote = `Claude failed: ${String(err).slice(0, 200)}`;
        console.error("copilot attempt failed", String(err));
      }
    }
    if (suggestion === null) {
      suggestion = pickFallback(info.question);
      cached = true;
    }

    // Only a highlight RDKit verifies gets a preview.
    let previewId: Id<"previews"> | undefined;
    let chemNote: string | undefined;
    if (suggestion.molecule && suggestion.groupId) {
      try {
        const visual = await fetchHighlight(suggestion.molecule, suggestion.groupId);
        previewId = await ctx.runMutation(internal.visuals.savePreview, {
          sessionId: args.sessionId,
          ...visual,
        });
      } catch (err) {
        chemNote = err instanceof ConvexError ? String(err.data) : "Could not verify";
      }
    }
    const note = cached
      ? [claudeNote, chemNote].filter(Boolean).join("; ") || undefined
      : chemNote;

    return await ctx.runMutation(internal.copilot.save, {
      sessionId: args.sessionId,
      questionId: args.questionId,
      ...suggestion,
      previewId,
      note,
      cached,
    });
  },
});
