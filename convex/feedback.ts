import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProfessor } from "./lib/auth";

const value = v.union(v.literal("confused"), v.literal("understood"));

// One vote per student per slide; voting again on the same slide replaces it.
// The slide is the one on screen now, read here rather than from the browser.
export const set = mutation({
  args: { sessionId: v.id("sessions"), studentId: v.string(), value },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (session === null) throw new ConvexError("Session not found");
    const slideIndex = session.slideIndex;
    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_session_and_slideIndex_and_studentId", (q) =>
        q.eq("sessionId", args.sessionId).eq("slideIndex", slideIndex).eq("studentId", args.studentId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch("feedback", existing._id, { value: args.value });
    } else {
      await ctx.db.insert("feedback", {
        sessionId: args.sessionId,
        studentId: args.studentId,
        value: args.value,
        slideIndex,
      });
    }
  },
});

// Public aggregate counts for the slide on screen now.
export const counts = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (session === null) return { confused: 0, understood: 0 };
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_session_and_slideIndex_and_studentId", (q) =>
        q.eq("sessionId", args.sessionId).eq("slideIndex", session.slideIndex),
      )
      .take(1000);
    let confused = 0;
    for (const row of rows) if (row.value === "confused") confused++;
    return { confused, understood: rows.length - confused };
  },
});

// A student's own vote on the current slide, so the buttons clear when the
// slide changes or the professor resets.
export const mine = query({
  args: { sessionId: v.id("sessions"), studentId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (session === null) return null;
    const row = await ctx.db
      .query("feedback")
      .withIndex("by_session_and_slideIndex_and_studentId", (q) =>
        q
          .eq("sessionId", args.sessionId)
          .eq("slideIndex", session.slideIndex)
          .eq("studentId", args.studentId),
      )
      .unique();
    return row?.value ?? null;
  },
});

// Professor only: votes per slide across the session, to spot where the class
// got lost. Slides nobody voted on are left out.
export const bySlide = query({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(5000);
    const slides = new Map<number, { confused: number; understood: number }>();
    for (const row of rows) {
      if (row.slideIndex === undefined) continue;
      const tally = slides.get(row.slideIndex) ?? { confused: 0, understood: 0 };
      tally[row.value]++;
      slides.set(row.slideIndex, tally);
    }
    return [...slides.entries()]
      .sort(([a], [b]) => a - b)
      .map(([slideIndex, tally]) => ({ slideIndex, ...tally }));
  },
});

// Clears everyone's vote on the current slide, for starting that topic fresh.
export const reset = mutation({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    const session = await requireProfessor(ctx, args.sessionId, args.token);
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_session_and_slideIndex_and_studentId", (q) =>
        q.eq("sessionId", args.sessionId).eq("slideIndex", session.slideIndex),
      )
      .take(1000);
    for (const row of rows) await ctx.db.delete("feedback", row._id);
  },
});
