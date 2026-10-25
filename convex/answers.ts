import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { ANSWER_SCHEMA, ANSWER_SYSTEM } from "./ai/answerPrompt";
import { quoteAppears } from "./lib/verify";
import { searchLessons, type Passage } from "./retrieval";

const MODEL = "claude-sonnet-5-5";
const CLAUDE_TIMEOUT_MS = 10000;
// Passages scoring below this never reach Claude. Tuned on a small sample
// lesson (covered questions scored 0.41-0.65, unrelated ones under 0.1).
const RETRIEVAL_FLOOR = 0.25;
const PASSAGES_FOR_CLAUDE = 5;
const FALLBACK_WORDS = 120;

type Quote = { chunkId: Id<"lessonChunks">; label: string; text: string };

type Outcome =
  | { status: "answered"; text: string; quotes: Quote[] }
  | { status: "not_covered"; note: string };

const label = (p: Passage) =>
  p.heading ? `${p.lessonTitle} › ${p.heading}` : p.lessonTitle;

export const getJob = internalQuery({
  args: { answerId: v.id("answers") },
  handler: async (ctx, args) => {
    const answer = await ctx.db.get(args.answerId);
    if (answer === null || answer.status !== "pending") return null;
    const [question, session] = await Promise.all([
      ctx.db.get(answer.questionId),
      ctx.db.get(answer.sessionId),
    ]);
    if (question === null || session?.courseId === undefined) return null;
    return { question: question.text, courseId: session.courseId };
  },
});

export const finish = internalMutation({
  args: {
    answerId: v.id("answers"),
    status: v.union(
      v.literal("answered"),
      v.literal("fallback"),
      v.literal("not_covered"),
      v.literal("failed"),
    ),
    text: v.optional(v.string()),
    quotes: v.optional(
      v.array(
        v.object({
          chunkId: v.id("lessonChunks"),
          label: v.string(),
          text: v.string(),
        }),
      ),
    ),
    note: v.optional(v.string()),
    topScore: v.optional(v.number()),
    retrievalMs: v.optional(v.number()),
    claudeMs: v.optional(v.number()),
    totalMs: v.optional(v.number()),
  },
  handler: async (ctx, { answerId, ...fields }) => {
    await ctx.db.patch(answerId, fields);
  },
});

class ClaudeTimeout extends Error {}
class VerificationFailed extends Error {}

// One Claude call. Throws ClaudeTimeout on a slow call, VerificationFailed if
// a quote can't be found in the passage it names; returns not_covered when
// Claude says the passages don't answer the question.
async function askClaude(question: string, passages: Passage[]): Promise<Outcome> {
  const byId = new Map(passages.map((p, i) => [`P${i + 1}`, p]));
  const context = passages
    .map((p, i) => `[P${i + 1}] ${p.text}`)
    .join("\n\n");

  const client = new Anthropic({ maxRetries: 0, timeout: CLAUDE_TIMEOUT_MS });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: ANSWER_SYSTEM,
      // Thinking off and low effort keep this inside the time budget.
      thinking: { type: "between_tools" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: ANSWER_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `<passages>\n${context}\n</passages>\n\n<question>\n${question}\n</question>`,
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new ClaudeTimeout();
    throw err;
  }

  const block = response.content.find((b) => b.type === "text");
  if (response.stop_reason !== "end_turn" || block?.type !== "text") {
    throw new Error(`Unusable response (${response.stop_reason})`);
  }
  const out = JSON.parse(block.text) as {
    covered: boolean;
    answer: string;
    quotes: { passage_id: string; quote: string }[];
  };

  if (!out.covered) {
    return { status: "not_covered", note: "The passages don't answer the question" };
  }
  if (out.answer.trim() === "" || out.quotes.length === 0) {
    throw new VerificationFailed("No answer or no supporting quote");
  }
  const quotes: Quote[] = [];
  for (const q of out.quotes) {
    const passage = byId.get(q.passage_id);
    if (!passage || !quoteAppears(q.quote, passage.text)) {
      throw new VerificationFailed(`Quote not found in ${q.passage_id}`);
    }
    quotes.push({ chunkId: passage.chunkId, label: label(passage), text: q.quote.trim() });
  }
  return { status: "answered", text: out.answer.trim(), quotes };
}

// Generates and verifies the answer to one question, then stores it.
export const generate = internalAction({
  args: { answerId: v.id("answers") },
  handler: async (ctx, { answerId }) => {
    const started = Date.now();
    const done = (fields: {
      status: "answered" | "fallback" | "not_covered" | "failed";
      text?: string;
      quotes?: Quote[];
      note?: string;
      topScore?: number;
      retrievalMs?: number;
      claudeMs?: number;
    }) =>
      ctx.runMutation(internal.answers.finish, {
        answerId,
        ...fields,
        totalMs: Date.now() - started,
      });

    try {
      const job = await ctx.runQuery(internal.answers.getJob, { answerId });
      if (job === null) return;

      let passages: Passage[];
      try {
        passages = await searchLessons(ctx, job.courseId, job.question, PASSAGES_FOR_CLAUDE);
      } catch (err) {
        await done({ status: "failed", note: `Search failed: ${String(err).slice(0, 150)}` });
        return;
      }
      const retrievalMs = Date.now() - started;
      const topScore = passages[0]?.score;
      const relevant = passages.filter((p) => p.score >= RETRIEVAL_FLOOR);
      if (relevant.length === 0) {
        await done({
          status: "not_covered",
          note: "No lesson passage is similar enough to the question",
          topScore,
          retrievalMs,
        });
        return;
      }

      // Retry once on a fast failure or a failed quote check, never after a timeout.
      let claudeNote = "";
      const claudeStart = Date.now();
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const outcome = await askClaude(job.question, relevant);
          await done({
            ...outcome,
            topScore,
            retrievalMs,
            claudeMs: Date.now() - claudeStart,
          });
          return;
        } catch (err) {
          if (err instanceof ClaudeTimeout) {
            claudeNote = `Claude timed out after ${CLAUDE_TIMEOUT_MS / 1000}s`;
            break;
          }
          claudeNote =
            err instanceof VerificationFailed
              ? `Quote check failed: ${err.message}`
              : `Claude failed: ${String(err).slice(0, 150)}`;
        }
      }

      if (claudeNote.startsWith("Quote check failed")) {
        // Claude answered but couldn't back it up: don't show an unverified answer.
        await done({
          status: "not_covered",
          note: claudeNote,
          topScore,
          retrievalMs,
          claudeMs: Date.now() - claudeStart,
        });
        return;
      }

      // Claude is slow or down: show the closest passage verbatim.
      const best = relevant[0];
      const words = best.text.split(/\s+/);
      const excerpt =
        words.length > FALLBACK_WORDS ? words.slice(0, FALLBACK_WORDS).join(" ") : best.text;
      await done({
        status: "fallback",
        text: "The assistant is slow right now. This is the closest passage from your lesson:",
        quotes: [{ chunkId: best.chunkId, label: label(best), text: excerpt }],
        note: claudeNote,
        topScore,
        retrievalMs,
        claudeMs: Date.now() - claudeStart,
      });
    } catch (err) {
      await done({ status: "failed", note: `Unexpected error: ${String(err).slice(0, 150)}` });
    }
  },
});
