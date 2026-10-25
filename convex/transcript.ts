import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireProfessor } from "./lib/auth";
import { countWords } from "./lib/chunk";
import { embedTexts } from "./lib/embed";

const FLUSH_DELAY_MS = 30_000;
// A stretch of lecture becomes one searchable chunk once it reaches this many
// words (or when the professor pauses).
const CHUNK_WORDS = 60;
const MAX_LINE_CHARS = 1000;
const MAX_LINES_PER_SESSION = 5000;
const SHOWN_LINES = 40;

type PendingLine = {
  _id: Id<"transcriptLines">;
  courseId: Id<"courses">;
  text: string;
  startedAt: number;
};

// ---------------------------------------------------------------- lines ----

export const addLine = mutation({
  args: { sessionId: v.id("sessions"), token: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const session = await requireProfessor(ctx, args.sessionId, args.token);
    if (!session.courseId) throw new ConvexError("Session has no course");
    const text = args.text.trim().slice(0, MAX_LINE_CHARS);
    if (text === "") return;

    const lines = await ctx.db
      .query("transcriptLines")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(MAX_LINES_PER_SESSION);
    if (lines.length >= MAX_LINES_PER_SESSION) {
      throw new ConvexError("This session's transcript is full");
    }
    await ctx.db.insert("transcriptLines", {
      sessionId: args.sessionId,
      courseId: session.courseId,
      text,
      startedAt: Date.now(),
    });
    if (!session.flushPending) {
      await ctx.db.patch(args.sessionId, { flushPending: true });
      await ctx.scheduler.runAfter(FLUSH_DELAY_MS, internal.transcript.flush, {
        sessionId: args.sessionId,
        final: false,
      });
    }
  },
});

// The latest lines, oldest first, for the professor's transcript panel.
export const lines = query({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const rows = await ctx.db
      .query("transcriptLines")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(SHOWN_LINES);
    return rows.reverse().map((r) => ({
      _id: r._id,
      text: r.text,
      startedAt: r.startedAt,
    }));
  },
});

export const editLine = mutation({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    lineId: v.id("transcriptLines"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const line = await ctx.db.get(args.lineId);
    if (line === null || line.sessionId !== args.sessionId) {
      throw new ConvexError("Line not found");
    }
    const text = args.text.trim().slice(0, MAX_LINE_CHARS);
    if (text === "") throw new ConvexError("A line can't be empty; delete it instead");
    await ctx.db.patch(args.lineId, { text });
    if (line.chunkId) {
      await ctx.scheduler.runAfter(0, internal.transcript.rebuildChunk, {
        chunkId: line.chunkId,
      });
    }
  },
});

export const deleteLine = mutation({
  args: {
    sessionId: v.id("sessions"),
    token: v.string(),
    lineId: v.id("transcriptLines"),
  },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    const line = await ctx.db.get(args.lineId);
    if (line === null || line.sessionId !== args.sessionId) {
      throw new ConvexError("Line not found");
    }
    await ctx.db.delete(args.lineId);
    if (line.chunkId) {
      await ctx.scheduler.runAfter(0, internal.transcript.rebuildChunk, {
        chunkId: line.chunkId,
      });
    }
  },
});

// Students are told when the lecture is being transcribed.
export const setTranscribing = mutation({
  args: { sessionId: v.id("sessions"), token: v.string(), on: v.boolean() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    await ctx.db.patch(args.sessionId, { transcribing: args.on });
  },
});

// ------------------------------------------------------ chunks and search ---

export const unchunked = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("transcriptLines")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(400);
    return rows
      .filter((r) => r.chunkId === undefined)
      .reverse()
      .map((r) => ({
        _id: r._id,
        courseId: r.courseId,
        text: r.text,
        startedAt: r.startedAt,
      }));
  },
});

export const storeChunk = internalMutation({
  args: {
    courseId: v.id("courses"),
    sessionId: v.id("sessions"),
    text: v.string(),
    startedAt: v.number(),
    endedAt: v.number(),
    embedding: v.array(v.float64()),
    lineIds: v.array(v.id("transcriptLines")),
  },
  handler: async (ctx, { lineIds, ...chunk }) => {
    const chunkId = await ctx.db.insert("transcriptChunks", chunk);
    for (const lineId of lineIds) {
      // A line deleted while we were embedding is simply skipped.
      if (await ctx.db.get(lineId)) await ctx.db.patch(lineId, { chunkId });
    }
  },
});

export const setFlushPending = internalMutation({
  args: { sessionId: v.id("sessions"), pending: v.boolean() },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.sessionId)) {
      await ctx.db.patch(args.sessionId, { flushPending: args.pending });
    }
  },
});

// Turns new lines into embedded chunks. `final` also chunks a short tail.
export const flush = internalAction({
  args: { sessionId: v.id("sessions"), final: v.boolean() },
  handler: async (ctx, args): Promise<void> => {
    try {
      const lines: PendingLine[] = await ctx.runQuery(
        internal.transcript.unchunked,
        { sessionId: args.sessionId },
      );
      const groups: PendingLine[][] = [];
      let current: PendingLine[] = [];
      let words = 0;
      for (const line of lines) {
        current.push(line);
        words += countWords(line.text);
        if (words >= CHUNK_WORDS) {
          groups.push(current);
          current = [];
          words = 0;
        }
      }
      if (current.length > 0 && args.final) groups.push(current);

      if (groups.length > 0) {
        const texts = groups.map((g) => g.map((l) => l.text).join(" "));
        const vectors = await embedTexts(texts, "document");
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          await ctx.runMutation(internal.transcript.storeChunk, {
            courseId: g[0].courseId,
            sessionId: args.sessionId,
            text: texts[i],
            startedAt: g[0].startedAt,
            endedAt: g[g.length - 1].startedAt,
            embedding: vectors[i],
            lineIds: g.map((l) => l._id),
          });
        }
      }
    } catch (err) {
      // Lines stay unchunked and are retried on the next flush.
      console.error("transcript flush failed", String(err).slice(0, 150));
    }

    // More lines waiting (a short tail, or a failure)? Try again later.
    const rest: PendingLine[] = await ctx.runQuery(
      internal.transcript.unchunked,
      { sessionId: args.sessionId },
    );
    if (rest.length > 0 && !args.final) {
      await ctx.scheduler.runAfter(FLUSH_DELAY_MS, internal.transcript.flush, {
        sessionId: args.sessionId,
        final: false,
      });
    } else {
      await ctx.runMutation(internal.transcript.setFlushPending, {
        sessionId: args.sessionId,
        pending: false,
      });
    }
  },
});

// Called when the professor pauses: chunk everything now.
export const flushNow = action({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await ctx.runQuery(internal.transcript.checkProfessor, args);
    await ctx.runAction(internal.transcript.flush, {
      sessionId: args.sessionId,
      final: true,
    });
  },
});

export const checkProfessor = internalQuery({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args) => {
    await requireProfessor(ctx, args.sessionId, args.token);
    return null;
  },
});

export const chunkParts = internalQuery({
  args: { chunkId: v.id("transcriptChunks") },
  handler: async (ctx, args) => {
    const chunk = await ctx.db.get(args.chunkId);
    if (chunk === null) return null;
    const rows = await ctx.db
      .query("transcriptLines")
      .withIndex("by_chunk", (q) => q.eq("chunkId", args.chunkId))
      .take(200);
    return { lines: rows.sort((a, b) => a.startedAt - b.startedAt).map((r) => r.text) };
  },
});

export const replaceChunk = internalMutation({
  args: {
    chunkId: v.id("transcriptChunks"),
    text: v.union(v.string(), v.null()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.chunkId)) {
      if (args.text === null || args.embedding === undefined) {
        await ctx.db.delete(args.chunkId);
      } else {
        await ctx.db.patch(args.chunkId, {
          text: args.text,
          embedding: args.embedding,
        });
      }
    }
  },
});

// After a line is edited or deleted, rebuilds (or removes) its chunk so
// search and quote checks only ever see the corrected text.
export const rebuildChunk = internalAction({
  args: { chunkId: v.id("transcriptChunks") },
  handler: async (ctx, args) => {
    const parts = await ctx.runQuery(internal.transcript.chunkParts, args);
    if (parts === null) return;
    if (parts.lines.length === 0) {
      await ctx.runMutation(internal.transcript.replaceChunk, {
        chunkId: args.chunkId,
        text: null,
      });
      return;
    }
    const text = parts.lines.join(" ");
    try {
      const [embedding] = await embedTexts([text], "document");
      await ctx.runMutation(internal.transcript.replaceChunk, {
        chunkId: args.chunkId,
        text,
        embedding,
      });
    } catch (err) {
      // Without a fresh embedding the old text must not stay searchable.
      console.error("chunk rebuild failed", String(err).slice(0, 150));
      await ctx.runMutation(internal.transcript.replaceChunk, {
        chunkId: args.chunkId,
        text: null,
      });
    }
  },
});

// Lecture passages for the answer action.
export const hydrateChunks = internalQuery({
  args: { ids: v.array(v.id("transcriptChunks")) },
  handler: async (ctx, args) => {
    const out = [];
    for (const id of args.ids) {
      const chunk = await ctx.db.get(id);
      if (chunk === null) continue;
      const session = await ctx.db.get(chunk.sessionId);
      const minutesIn = Math.max(
        0,
        Math.round((chunk.startedAt - (session?._creationTime ?? chunk.startedAt)) / 60000),
      );
      out.push({
        chunkId: chunk._id,
        sessionId: chunk.sessionId,
        endedAt: chunk.endedAt,
        text: chunk.text,
        label: `Lecture "${session?.topic ?? "session"}", ${minutesIn} min in`,
      });
    }
    return out;
  },
});

// The last couple of minutes of this lecture, always available to answers
// even before they are embedded.
export const recent = internalQuery({
  args: { sessionId: v.id("sessions"), sinceMs: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("transcriptLines")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(80);
    const recentRows = rows.filter((r) => r.startedAt >= args.sinceMs).reverse();
    const session = await ctx.db.get(args.sessionId);
    return {
      text: recentRows.map((r) => r.text).join("\n"),
      topic: session?.topic ?? "session",
    };
  },
});

// ------------------------------------------------------------- deletion ----

export const deleteBatch = internalMutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const lines = await ctx.db
      .query("transcriptLines")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(200);
    for (const l of lines) await ctx.db.delete(l._id);
    const chunks = await ctx.db
      .query("transcriptChunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(200);
    for (const c of chunks) await ctx.db.delete(c._id);
    return lines.length + chunks.length;
  },
});

// Removes a session's whole transcript from the record and from search.
export const clear = action({
  args: { sessionId: v.id("sessions"), token: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await ctx.runQuery(internal.transcript.checkProfessor, args);
    while (
      (await ctx.runMutation(internal.transcript.deleteBatch, {
        sessionId: args.sessionId,
      })) > 0
    ) {
      // keep going until nothing is left
    }
  },
});
