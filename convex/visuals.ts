import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireProfessor } from "./lib/auth";
import { fetchHighlight } from "./lib/chem";
import { visualFields } from "./lib/visual";

export const checkProfessor = internalQuery({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    return null;
  },
});

export const savePreview = internalMutation({
  args: visualFields,
  handler: async (ctx, args) => {
    return await ctx.db.insert("previews", args);
  },
});

// Asks the chemistry service for a verified highlight and stores it as a
// private preview. Nothing here is visible to students.
export const buildPreview = action({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    query: v.string(),
    groupId: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    await ctx.runQuery(internal.visuals.checkProfessor, {
      sessionId: args.sessionId,
      token: args.token,
    });

    const visual = await fetchHighlight(args.query, args.groupId);
    return await ctx.runMutation(internal.visuals.savePreview, {
      sessionId: args.sessionId,
      ...visual,
    });
  },
});

export const listPreviews = query({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    return await ctx.db
      .query("previews")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(10);
  },
});

// Explicit publish: copies a preview to the public table, replacing the
// session's current visual.
export const publish = mutation({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    previewId: v.id("previews"),
  },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const preview = await ctx.db.get(args.previewId);
    if (preview === null || preview.sessionId !== args.sessionId) {
      throw new ConvexError("Preview not found");
    }
    const { _id, _creationTime, ...visual } = preview;
    const current = await ctx.db
      .query("published_visuals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (current) {
      await ctx.db.replace("published_visuals", current._id, visual);
    } else {
      await ctx.db.insert("published_visuals", visual);
    }
  },
});

export const unpublish = mutation({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const current = await ctx.db
      .query("published_visuals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (current) await ctx.db.delete(current._id);
  },
});

// Public: what students and the presentation view show.
export const current = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("published_visuals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
  },
});
