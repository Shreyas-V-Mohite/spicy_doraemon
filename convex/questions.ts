import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
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

const FLAGGED = new Set(["not_covered", "failed"]);

// The professor's queue as cards: similar questions are one card, counted by
// distinct students. Cards that need the professor (the lesson couldn't answer)
// come first, then the ones many students share, then the newest.
export const queue = query({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(300);
    const answers = new Map<string, Doc<"answers">>();
    for (const q of questions) {
      const a = await ctx.db
        .query("answers")
        .withIndex("by_question", (x) => x.eq("questionId", q._id))
        .unique();
      if (a) answers.set(q._id, a);
    }
    const groups = new Map<string, Doc<"questionGroups">>();
    for (const q of questions) {
      if (q.groupId && !groups.has(q.groupId)) {
        const g = await ctx.db.get(q.groupId);
        if (g) groups.set(q.groupId, g);
      }
    }

    // Newest first, so a card's first member is its latest question.
    const byKey = new Map<string, Doc<"questions">[]>();
    for (const q of questions) {
      const key = q.groupId ?? q._id;
      byKey.set(key, [...(byKey.get(key) ?? []), q]);
    }
    const cards = [...byKey.entries()].map(([key, members]) => {
      const group = groups.get(key);
      const rows = members.map((q) => {
        const a = answers.get(q._id);
        return {
          _id: q._id,
          text: q.text,
          status: q.status,
          _creationTime: q._creationTime,
          answerStatus: a?.status ?? null,
          answerNote: a?.note ?? null,
          answerText: a?.text ?? null,
          answerConflict: a?.conflict ?? false,
        };
      });
      const open = rows.filter((r) => r.status === "open");
      return {
        key,
        groupId: group ? group._id : null,
        label: group?.label ?? null,
        studentCount: new Set(members.map((m) => m.studentId)).size,
        open: open.length > 0,
        flagged: open.some(
          (r) => FLAGGED.has(r.answerStatus ?? "") || r.answerConflict,
        ),
        latest: members[0]._creationTime,
        members: rows,
      };
    });
    return cards.sort(
      (a, b) =>
        Number(b.flagged) - Number(a.flagged) ||
        b.studentCount - a.studentCount ||
        b.latest - a.latest,
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
        // Other students with a similar question: a count, never their text.
        let similarCount = 0;
        if (q.groupId) {
          const members = await ctx.db
            .query("questions")
            .withIndex("by_group", (x) => x.eq("groupId", q.groupId))
            .take(200);
          similarCount = new Set(
            members.map((m) => m.studentId).filter((id) => id !== args.studentId),
          ).size;
        }
        return {
          _id: q._id,
          _creationTime: q._creationTime,
          text: q.text,
          status: q.status,
          similarCount,
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

// Marks every open question in a card answered.
export const markGroupAnswered = mutation({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    groupId: v.id("questionGroups"),
  },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const group = await ctx.db.get(args.groupId);
    if (group === null || group.sessionId !== args.sessionId) {
      throw new ConvexError("Group not found");
    }
    const members = await ctx.db
      .query("questions")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .take(200);
    for (const m of members) await ctx.db.patch(m._id, { status: "answered" });
  },
});

// Takes one question out of its group, for a merge that was wrong.
export const splitFromGroup = mutation({
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
    await ctx.db.patch(args.questionId, { groupId: undefined });
  },
});
