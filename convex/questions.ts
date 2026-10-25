import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProfessor } from "./lib/auth";

const MAX_QUESTIONS_PER_STUDENT = 20;

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
    const open = await ctx.db
      .query("questions")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", args.sessionId).eq("studentId", args.studentId),
      )
      .take(MAX_QUESTIONS_PER_STUDENT);
    if (open.length >= MAX_QUESTIONS_PER_STUDENT) {
      throw new ConvexError("Question limit reached for this session");
    }
    await ctx.db.insert("questions", {
      sessionId: args.sessionId,
      studentId: args.studentId,
      text,
      status: "open",
    });
  },
});

// Professor queue: all questions, newest first.
export const listForProfessor = query({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    return await ctx.db
      .query("questions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(200);
  },
});

// A student sees only their own questions.
export const listMine = query({
  args: { sessionId: v.id("sessions"), studentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("questions")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", args.sessionId).eq("studentId", args.studentId),
      )
      .order("desc")
      .take(50);
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
