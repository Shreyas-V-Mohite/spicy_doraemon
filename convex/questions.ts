import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireProfessor } from "./lib/auth";

const MAX_QUESTIONS_PER_STUDENT = 20;
const MAX_QUESTIONS_PER_SESSION = 300;
const COOLDOWN_MS = 20_000;

export const submit = mutation({
  args: { sessionId: v.id("sessions"), studentId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const text = args.text.trim();
    if (text.length === 0 || text.length > 500) {
      throw new ConvexError("Question must be 1-500 characters");
    }
    if (!(await ctx.db.get(args.sessionId))) {
      throw new ConvexError("Session not found");
    }
    const mine = await ctx.db
      .query("questions")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", args.sessionId).eq("studentId", args.studentId),
      )
      .order("desc")
      .take(MAX_QUESTIONS_PER_STUDENT);
    if (mine.length >= MAX_QUESTIONS_PER_STUDENT) {
      throw new ConvexError("Question limit reached for this session");
    }
    if (mine.length > 0) {
      const wait = COOLDOWN_MS - (Date.now() - mine[0]._creationTime);
      if (wait > 0) {
        throw new ConvexError(`Please wait ${Math.ceil(wait / 1000)}s before asking again`);
      }
    }
    const inSession = await ctx.db
      .query("questions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(MAX_QUESTIONS_PER_SESSION);
    if (inSession.length >= MAX_QUESTIONS_PER_SESSION) {
      throw new ConvexError("This session has reached its question limit");
    }

    const questionId = await ctx.db.insert("questions", {
      sessionId: args.sessionId,
      studentId: args.studentId,
      text,
      status: "open",
    });
    const answerId = await ctx.db.insert("answers", {
      sessionId: args.sessionId,
      questionId,
      status: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.answers.generate, { answerId });
  },
});

// Professor queue: all questions, newest first.
export const listForProfessor = query({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(200);
    return await Promise.all(
      questions.map(async (q) => {
        const answer = await ctx.db
          .query("answers")
          .withIndex("by_question", (a) => a.eq("questionId", q._id))
          .unique();
        return {
          ...q,
          answerStatus: answer?.status ?? null,
          answerNote: answer?.note ?? null,
          answerText: answer?.text ?? null,
        };
      }),
    );
  },
});

// A student sees only their own questions.
export const listMine = query({
  args: { sessionId: v.id("sessions"), studentId: v.string() },
  handler: async (ctx, args) => {
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", args.sessionId).eq("studentId", args.studentId),
      )
      .order("desc")
      .take(50);
    return await Promise.all(
      questions.map(async (q) => {
        const answer = await ctx.db
          .query("answers")
          .withIndex("by_question", (a) => a.eq("questionId", q._id))
          .unique();
        return {
          _id: q._id,
          _creationTime: q._creationTime,
          text: q.text,
          status: q.status,
          answer: answer
            ? {
                status: answer.status,
                text: answer.text ?? null,
                quotes: (answer.quotes ?? []).map((x) => ({
                  label: x.label,
                  text: x.text,
                })),
              }
            : null,
        };
      }),
    );
  },
});

export const markAnswered = mutation({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    questionId: v.id("questions"),
  },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const question = await ctx.db.get(args.questionId);
    if (question === null || question.sessionId !== args.sessionId) {
      throw new ConvexError("Question not found");
    }
    await ctx.db.patch(args.questionId, { status: "answered" });
  },
});
