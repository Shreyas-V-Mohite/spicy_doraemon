import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
