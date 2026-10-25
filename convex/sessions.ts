import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCourseProfessor } from "./lib/auth";

// No 0/O/1/I so codes can be read aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

// A session belongs to a course; the course's professor token manages it.
export const create = mutation({
  args: { courseId: v.id("courses"), token: v.string(), topic: v.string() },
  handler: async (ctx, args) => {
    await requireCourseProfessor(ctx, args.courseId, args.token);
    const topic = args.topic.trim();
    if (topic.length === 0 || topic.length > 200) {
      throw new ConvexError("Topic must be 1-200 characters");
    }
    let code = randomCode();
    while (
      await ctx.db
        .query("sessions")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique()
    ) {
      code = randomCode();
    }
    const sessionId = await ctx.db.insert("sessions", {
      code,
      topic,
      courseId: args.courseId,
    });
    return { sessionId, code };
  },
});

// A course's sessions, newest first, for reopening a session.
export const listForCourse = query({
  args: { courseId: v.id("courses"), token: v.string() },
  handler: async (ctx, args) => {
    await requireCourseProfessor(ctx, args.courseId, args.token);
    const sessions = await ctx.db.query("sessions").order("desc").take(200);
    return sessions
      .filter((s) => s.courseId === args.courseId)
      .slice(0, 30)
      .map((s) => ({
        _id: s._id,
        code: s.code,
        topic: s.topic,
        _creationTime: s._creationTime,
      }));
  },
});

// Public: join code lookup. Returns public fields only.
export const getByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .unique();
    if (session === null) return null;
    return {
      _id: session._id,
      code: session.code,
      topic: session.topic,
      courseId: session.courseId,
      transcribing: session.transcribing ?? false,
      hasSlides: session.slidesFileId !== undefined,
      slideCount: session.slideCount ?? 0,
      slideIndex: session.slideIndex ?? 0,
      stageMode: session.stageMode ?? "slides",
      broadcasting: session.broadcasting ?? false,
      liveEpoch: session.liveEpoch ?? 0,
      handMode: session.handMode ?? false,
      relayUntil: session.relayUntil ?? 0,
    };
  },
});
