import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { sha256Hex } from "./lib/auth";

const MAX_TOKENS_PER_COURSE = 10;

function checkPasscode(passcode: string) {
  if (passcode !== process.env.PROFESSOR_PASSCODE) {
    throw new ConvexError("Wrong passcode");
  }
}

// The browser token is generated client-side; only its hash is stored.
export const create = mutation({
  args: { passcode: v.string(), token: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    checkPasscode(args.passcode);
    const name = args.name.trim();
    if (name.length === 0 || name.length > 100) {
      throw new ConvexError("Course name must be 1-100 characters");
    }
    return await ctx.db.insert("courses", {
      name,
      tokenHashes: [await sha256Hex(args.token)],
    });
  },
});

// Lists courses for someone who knows the passcode (a new browser, say).
export const list = query({
  args: { passcode: v.string() },
  handler: async (ctx, args) => {
    // null (not an error) so the sign-in form can say "wrong passcode".
    if (args.passcode !== process.env.PROFESSOR_PASSCODE) return null;
    const courses = await ctx.db.query("courses").order("desc").take(50);
    return courses.map((c) => ({ _id: c._id, name: c.name }));
  },
});

// Lets this browser's token manage an existing course.
export const claim = mutation({
  args: { passcode: v.string(), courseId: v.id("courses"), token: v.string() },
  handler: async (ctx, args) => {
    checkPasscode(args.passcode);
    const course = await ctx.db.get(args.courseId);
    if (course === null) throw new ConvexError("Course not found");
    const hash = await sha256Hex(args.token);
    if (course.tokenHashes.includes(hash)) return;
    await ctx.db.patch(args.courseId, {
      tokenHashes: [...course.tokenHashes, hash].slice(-MAX_TOKENS_PER_COURSE),
    });
  },
});

export const get = query({
  args: { courseId: v.id("courses"), token: v.string() },
  handler: async (ctx, args) => {
    // null when this browser isn't the course's professor.
    const course = await ctx.db.get(args.courseId);
    if (course === null || !course.tokenHashes.includes(await sha256Hex(args.token))) {
      return null;
    }
    return { _id: course._id, name: course.name };
  },
});
