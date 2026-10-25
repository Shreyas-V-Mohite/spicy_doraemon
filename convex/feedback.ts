import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProfessor } from "./lib/auth";

const value = v.union(v.literal("confused"), v.literal("understood"));

// One current vote per student; voting again replaces it.
export const set = mutation({
  args: { sessionId: v.id("sessions"), studentId: v.string(), value },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", args.sessionId).eq("studentId", args.studentId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("feedback", {
        sessionId: args.sessionId,
        studentId: args.studentId,
        value: args.value,
      });
    }
  },
});

// Public aggregate counts only.
export const counts = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(1000);
    let confused = 0;
    for (const row of rows) if (row.value === "confused") confused++;
    return { confused, understood: rows.length - confused };
  },
});

// A student's own current vote, so the UI reflects resets.
export const mine = query({
  args: { sessionId: v.id("sessions"), studentId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("feedback")
      .withIndex("by_session_and_student", (q) =>
        q.eq("sessionId", args.sessionId).eq("studentId", args.studentId),
      )
      .unique();
    return row?.value ?? null;
  },
});

// Clears everyone's vote, for starting a fresh topic.
export const reset = mutation({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(1000);
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
