import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProfessor } from "./lib/auth";

// Puts a question and the answer its student saw on every screen. Only
// answers that were actually shown (answered, or the closest-passage
// fallback) can be shared, and the student's identity is never included.
export const shareAnswer = mutation({
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
    const answer = await ctx.db
      .query("answers")
      .withIndex("by_question", (q) => q.eq("questionId", args.questionId))
      .unique();
    if (
      answer === null ||
      (answer.status !== "answered" && answer.status !== "fallback") ||
      !answer.text
    ) {
      throw new ConvexError("That question has no answer to share");
    }
    const doc = {
      sessionId: args.sessionId,
      question: question.text,
      answer: answer.text,
      quotes: (answer.quotes ?? []).map((x) => ({ label: x.label, text: x.text })),
    };
    const current = await ctx.db
      .query("sharedAnswers")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (current) await ctx.db.replace("sharedAnswers", current._id, doc);
    else await ctx.db.insert("sharedAnswers", doc);
  },
});

export const stopSharingAnswer = mutation({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const current = await ctx.db
      .query("sharedAnswers")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (current) await ctx.db.delete(current._id);
  },
});

// Public: the answer currently on the class screen.
export const currentAnswer = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const shared = await ctx.db
      .query("sharedAnswers")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (shared === null) return null;
    return { question: shared.question, answer: shared.answer, quotes: shared.quotes };
  },
});
