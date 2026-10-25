import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

const MAX_HISTORY = 20;
const MAX_ANSWER_CHARS = 400;

// What to remember when answering a question: the lecture topic, what the
// professor has on the class screen, and this student's own earlier questions
// and answers in the session. Only the asking student's history is used, so
// an answer can never mention what a classmate asked.
export const forQuestion = internalQuery({
  args: { questionId: v.id("questions") },
  handler: async (ctx, args) => {
    const question = await ctx.db.get(args.questionId);
    if (question === null) return { topic: "", screen: null, history: [] };
    const session = await ctx.db.get(question.sessionId);

    const mine = await ctx.db
      .query("questions")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", question.sessionId).eq("studentId", question.studentId),
      )
      .order("asc")
      .take(MAX_HISTORY + 1);
    const earlier = mine.filter((q) => q._creationTime < question._creationTime);

    const history: { question: string; answer: string | null }[] = [];
    for (const q of earlier) {
      const a = await ctx.db
        .query("answers")
        .withIndex("by_question", (x) => x.eq("questionId", q._id))
        .unique();
      let answer: string | null = null;
      if ((a?.status === "answered" || a?.status === "fallback") && a.text) {
        answer = a.text.slice(0, MAX_ANSWER_CHARS);
      } else if (a?.status === "not_covered") {
        answer = "(the lesson did not cover this)";
      }
      history.push({ question: q.text, answer });
    }

    const visual = await ctx.db
      .query("published_visuals")
      .withIndex("by_session", (q) => q.eq("sessionId", question.sessionId))
      .unique();
    const screen = visual
      ? visual.groupId
        ? `${visual.label} in ${visual.query}`
        : visual.query
      : null;

    return { topic: session?.topic ?? "", screen, history };
  },
});
