import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { ANSWER_SCHEMA, ANSWER_SYSTEM } from "./ai/answerPrompt";
import { quoteAppears } from "./lib/verify";
import { GROUP_THRESHOLD, REUSE_THRESHOLD } from "./grouping";
import { embedTexts } from "./lib/embed";
import { quoteValidator } from "./lib/quotes";
import { contextualQuery, looksContextual } from "./lib/context";
import { mergePassages, searchCourse, type Passage } from "./retrieval";

const MODEL = "claude-sonnet-5-5";
const CLAUDE_TIMEOUT_MS = 10000;
// Passages scoring below this never reach Claude. Measured with
// scripts/eval.mjs on a synthetic lesson: questions the lesson covers had a
// best score of 0.24-0.71, questions unrelated to chemistry topped out at
// 0.22. Wrongly refusing a covered question is worse than one extra Claude
// call, so the floor sits just under the weakest covered question.
const RETRIEVAL_FLOOR = 0.2;
const PASSAGES_FOR_CLAUDE = 6;
// The last stretch of the live lecture is always shown to Claude, even
// before it has been embedded.
const RECENT_WINDOW_MS = 120_000;
const FALLBACK_WORDS = 120;

type Quote = {
  source?: "lesson" | "transcript";
  chunkId?: Id<"lessonChunks"> | Id<"transcriptChunks">;
  label: string;
  text: string;
};

type Outcome =
  | { status: "answered"; text: string; quotes: Quote[]; conflict: boolean; note?: string }
  | { status: "not_covered"; note: string };

// A passage as Claude sees it, with the short id it must cite.
type Item = { id: string; tag: string; passage: Pick<Passage, "source" | "chunkId" | "label" | "text"> };

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
    return {
      question: question.text,
      questionId: question._id,
      sessionId: answer.sessionId,
      courseId: session.courseId,
    };
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
    quotes: v.optional(v.array(quoteValidator)),
    note: v.optional(v.string()),
    conflict: v.optional(v.boolean()),
    reusedFrom: v.optional(v.id("questions")),
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
type Memory = {
  topic: string;
  screen: string | null;
  history: { question: string; answer: string | null }[];
};

function renderContext(memory: Memory): string {
  const lines = [`Lecture topic: ${memory.topic}`];
  if (memory.screen) lines.push(`On the class screen: ${memory.screen}`);
  if (memory.history.length > 0) {
    lines.push("This student's earlier questions in this session:");
    for (const h of memory.history) {
      lines.push(`Q: ${h.question}`);
      if (h.answer) lines.push(`A: ${h.answer}`);
    }
  }
  return lines.join("\n");
}

async function askClaude(
  question: string,
  items: Item[],
  memory: Memory,
): Promise<Outcome> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const context = items
    .map((i) => `[${i.id}] (${i.tag}) ${i.passage.text}`)
    .join("\n\n");

  const client = new Anthropic({ maxRetries: 0, timeout: CLAUDE_TIMEOUT_MS });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
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
          content: `<context>\n${renderContext(memory)}\n</context>\n\n<passages>\n${context}\n</passages>\n\n<question>\n${question}\n</question>`,
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
    conflict: boolean;
    conflict_note: string;
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
    const item = byId.get(q.passage_id);
    if (!item || !quoteAppears(q.quote, item.passage.text)) {
      throw new VerificationFailed(`Quote not found in ${q.passage_id}`);
    }
    quotes.push({
      source: item.passage.source,
      chunkId: item.passage.chunkId ?? undefined,
      label: item.passage.label,
      text: q.quote.trim(),
    });
  }
  // When the lecture and lesson disagree, the lesson must be what is quoted.
  if (out.conflict && !quotes.some((q) => q.source === "lesson")) {
    throw new VerificationFailed("Conflict reported but the lesson was not quoted");
  }
  return {
    status: "answered",
    text: out.answer.trim(),
    // The student sees only the lesson's side of a disagreement; the
    // professor sees the note explaining it.
    quotes: out.conflict ? quotes.filter((q) => q.source === "lesson") : quotes,
    conflict: out.conflict,
    note: out.conflict
      ? `Lecture and lesson disagree: ${out.conflict_note.slice(0, 200)}`
      : undefined,
  };
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
      conflict?: boolean;
      reusedFrom?: Id<"questions">;
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

      // Embed once: the same vector finds similar questions and lesson passages.
      const memory = await ctx.runQuery(internal.memory.forQuestion, {
        questionId: job.questionId,
      });
      // A follow-up is also searched with its context, and is never grouped
      // with or answered from other students' questions.
      const contextual = looksContextual(job.question);
      const followUpText = contextual
        ? contextualQuery({
            screen: memory.screen,
            previousQuestion: memory.history.at(-1)?.question ?? null,
            question: job.question,
          })
        : null;
      let vector: number[];
      let contextVector: number[] | null = null;
      try {
        const texts =
          followUpText && followUpText !== job.question
            ? [job.question, followUpText]
            : [job.question];
        const vectors = await embedTexts(texts, "query");
        vector = vectors[0];
        contextVector = vectors[1] ?? null;
      } catch (err) {
        await done({ status: "failed", note: `Search failed: ${String(err).slice(0, 150)}` });
        return;
      }

      // Similar earlier questions in this session: group with them, and
      // reuse a verified answer if one is nearly identical. Follow-ups skip
      // this: "why does that happen?" means something different to each student.
      if (!contextual) {
        const hits = await ctx.vectorSearch("questionVectors", "by_embedding", {
          vector,
          limit: 5,
          filter: (q) => q.eq("sessionId", job.sessionId),
        });
        const neighbors = await ctx.runQuery(internal.grouping.neighborInfo, {
          vectorIds: hits.map((h) => h._id),
        });
        const scored = hits.flatMap((h) => {
          const info = neighbors.find((n) => n.vectorId === h._id);
          return info ? [{ ...info, score: h._score }] : [];
        });
        const groupWith = scored.find((n) => n.score >= GROUP_THRESHOLD);
        const reuseFrom = scored.find(
          (n) =>
            n.score >= REUSE_THRESHOLD &&
            n.reusable &&
            n.answerText !== null &&
            n.answerQuotes !== null,
        );
        const group = await ctx.runMutation(internal.grouping.assign, {
          questionId: job.questionId,
          sessionId: job.sessionId,
          embedding: vector,
          neighborQuestionId: groupWith?.questionId ?? null,
        });
        if (group && group.students >= 2 && !group.labelled) {
          await ctx.scheduler.runAfter(0, internal.grouping.labelGroup, {
            groupId: group.groupId,
          });
        }

        if (reuseFrom) {
          await done({
            status: "answered",
            text: reuseFrom.answerText!,
            quotes: reuseFrom.answerQuotes!,
            note: "Reused from a near-identical question",
            reusedFrom: reuseFrom.questionId,
            topScore: reuseFrom.score,
          });
          return;
        }
      }

      let passages: Passage[];
      let recent: { text: string; topic: string };
      try {
        passages = await searchCourse(ctx, job.courseId, vector);
        if (contextVector) {
          passages = mergePassages(
            passages,
            await searchCourse(ctx, job.courseId, contextVector),
          );
        }
        recent = await ctx.runQuery(internal.transcript.recent, {
          sessionId: job.sessionId,
          sinceMs: Date.now() - RECENT_WINDOW_MS,
        });
      } catch (err) {
        await done({ status: "failed", note: `Search failed: ${String(err).slice(0, 150)}` });
        return;
      }
      const retrievalMs = Date.now() - started;
      const topScore = passages[0]?.score;

      // This session's last two minutes arrive as their own passage, so drop
      // embedded chunks that overlap it.
      const windowStart = Date.now() - RECENT_WINDOW_MS;
      const relevant = passages
        .filter((p) => p.score >= RETRIEVAL_FLOOR)
        .filter(
          (p) =>
            !(
              p.source === "transcript" &&
              p.sessionId === job.sessionId &&
              (p.endedAt ?? 0) >= windowStart
            ),
        )
        .slice(0, PASSAGES_FOR_CLAUDE);

      const items: Item[] = [];
      let l = 0;
      let t = 0;
      for (const p of relevant) {
        items.push(
          p.source === "lesson"
            ? { id: `L${++l}`, tag: "lesson", passage: p }
            : { id: `T${++t}`, tag: "lecture", passage: p },
        );
      }
      if (recent.text.trim() !== "") {
        items.push({
          id: "R1",
          tag: "just now",
          passage: {
            source: "transcript",
            chunkId: null,
            label: `Lecture "${recent.topic}", just now`,
            text: recent.text,
          },
        });
      }
      if (items.length === 0) {
        await done({
          status: "not_covered",
          note: "No lesson or lecture passage is similar enough to the question",
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
          const outcome = await askClaude(job.question, items, memory);
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
      const best = items[0].passage;
      const words = best.text.split(/\s+/);
      const excerpt =
        words.length > FALLBACK_WORDS ? words.slice(0, FALLBACK_WORDS).join(" ") : best.text;
      await done({
        status: "fallback",
        text: "The assistant is slow right now. This is the closest passage I found:",
        quotes: [
          {
            source: best.source,
            chunkId: best.chunkId ?? undefined,
            label: best.label,
            text: excerpt,
          },
        ],
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
