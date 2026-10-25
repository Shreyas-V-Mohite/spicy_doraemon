import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { requireCourseProfessor } from "./lib/auth";
import {
  chunkLesson,
  countWords,
  embedText,
  MAX_LESSON_WORDS,
} from "./lib/chunk";
import { embedTexts } from "./lib/embed";

const INSERT_BATCH = 40;
const DELETE_BATCH = 100;

export const checkCourse = internalQuery({
  args: { courseId: v.id("courses"), token: v.string() },
  handler: async (ctx, args) => {
    await requireCourseProfessor(ctx, args.courseId, args.token);
    return null;
  },
});

// Authorizes the course AND that the lesson belongs to it.
export const checkLesson = internalQuery({
  args: {
    courseId: v.id("courses"),
    token: v.string(),
    lessonId: v.id("lessons"),
  },
  handler: async (ctx, args) => {
    await requireCourseProfessor(ctx, args.courseId, args.token);
    const lesson = await ctx.db.get(args.lessonId);
    if (lesson === null || lesson.courseId !== args.courseId) {
      throw new ConvexError("Lesson not found");
    }
    return null;
  },
});

export const list = query({
  args: { courseId: v.id("courses"), token: v.string() },
  handler: async (ctx, args) => {
    await requireCourseProfessor(ctx, args.courseId, args.token);
    const lessons = await ctx.db
      .query("lessons")
      .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
      .order("desc")
      .take(100);
    return lessons.map(({ text: _text, ...rest }) => rest);
  },
});

// The full text, loaded only when the professor opens a lesson to edit it.
export const getText = query({
  args: { courseId: v.id("courses"), token: v.string(), lessonId: v.id("lessons") },
  handler: async (ctx, args) => {
    await requireCourseProfessor(ctx, args.courseId, args.token);
    const lesson = await ctx.db.get(args.lessonId);
    if (lesson === null || lesson.courseId !== args.courseId) {
      throw new ConvexError("Lesson not found");
    }
    return { title: lesson.title, text: lesson.text };
  },
});

// Existing passages of a lesson, so unchanged ones keep their embeddings.
export const existingChunks = internalQuery({
  args: { lessonId: v.id("lessons") },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("lessonChunks")
      .withIndex("by_lesson", (q) => q.eq("lessonId", args.lessonId))
      .take(1000);
    return chunks.map((c) => ({
      heading: c.heading,
      text: c.text,
      embedding: c.embedding,
    }));
  },
});

export const startLesson = internalMutation({
  args: {
    courseId: v.id("courses"),
    title: v.string(),
    text: v.string(),
    wordCount: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("lessons", {
      ...args,
      chunkCount: 0,
      status: "saving",
    });
  },
});

export const addChunks = internalMutation({
  args: {
    courseId: v.id("courses"),
    lessonId: v.id("lessons"),
    chunks: v.array(
      v.object({
        ordinal: v.number(),
        heading: v.string(),
        text: v.string(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const chunk of args.chunks) {
      await ctx.db.insert("lessonChunks", {
        courseId: args.courseId,
        lessonId: args.lessonId,
        ...chunk,
      });
    }
  },
});

export const finishLesson = internalMutation({
  args: { lessonId: v.id("lessons"), chunkCount: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.lessonId, {
      chunkCount: args.chunkCount,
      status: "ready",
    });
  },
});

// Resets a lesson to "saving" with new text and removes its old passages.
export const beginReplace = internalMutation({
  args: {
    lessonId: v.id("lessons"),
    title: v.string(),
    text: v.string(),
    wordCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.lessonId, {
      title: args.title,
      text: args.text,
      wordCount: args.wordCount,
      status: "saving",
    });
  },
});

// Deletes up to a batch of a lesson's passages; returns how many remain.
export const deleteChunks = internalMutation({
  args: { lessonId: v.id("lessons") },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("lessonChunks")
      .withIndex("by_lesson", (q) => q.eq("lessonId", args.lessonId))
      .take(DELETE_BATCH);
    for (const chunk of chunks) await ctx.db.delete(chunk._id);
    return chunks.length === DELETE_BATCH ? 1 : 0;
  },
});

export const deleteLessonDoc = internalMutation({
  args: { lessonId: v.id("lessons") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.lessonId);
  },
});

async function purgeChunks(ctx: ActionCtx, lessonId: Id<"lessons">) {
  while ((await ctx.runMutation(internal.lessons.deleteChunks, { lessonId })) === 1) {
    // keep deleting until a batch comes back short
  }
}

function validateInput(title: string, text: string) {
  if (title.trim().length === 0 || title.length > 150) {
    throw new ConvexError("Title must be 1-150 characters");
  }
  const words = countWords(text);
  if (words === 0) throw new ConvexError("The lesson is empty");
  if (words > MAX_LESSON_WORDS) {
    throw new ConvexError(
      `Lessons are limited to ${MAX_LESSON_WORDS.toLocaleString()} words`,
    );
  }
  return words;
}

// Embeds every passage (reusing embeddings for passages already stored),
// then writes them in small batches.
async function saveChunks(
  ctx: ActionCtx,
  courseId: Id<"courses">,
  lessonId: Id<"lessons">,
  text: string,
  reuse: Map<string, number[]>,
) {
  const chunks = chunkLesson(text);
  if (chunks.length === 0) throw new ConvexError("The lesson is empty");

  const needed = chunks.filter((c) => !reuse.has(embedText(c)));
  const fresh = await embedTexts(needed.map(embedText), "document");
  const vectors = new Map(reuse);
  needed.forEach((c, i) => vectors.set(embedText(c), fresh[i]));

  for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
    await ctx.runMutation(internal.lessons.addChunks, {
      courseId,
      lessonId,
      chunks: chunks.slice(i, i + INSERT_BATCH).map((c) => ({
        ordinal: c.ordinal,
        heading: c.heading,
        text: c.text,
        embedding: vectors.get(embedText(c))!,
      })),
    });
  }
  await ctx.runMutation(internal.lessons.finishLesson, {
    lessonId,
    chunkCount: chunks.length,
  });
  return chunks.length;
}

export const create = action({
  args: {
    courseId: v.id("courses"),
    token: v.string(),
    title: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"lessons">> => {
    await ctx.runQuery(internal.lessons.checkCourse, {
      courseId: args.courseId,
      token: args.token,
    });
    const wordCount = validateInput(args.title, args.text);
    const lessonId = await ctx.runMutation(internal.lessons.startLesson, {
      courseId: args.courseId,
      title: args.title.trim(),
      text: args.text,
      wordCount,
    });
    try {
      await saveChunks(ctx, args.courseId, lessonId, args.text, new Map());
    } catch (err) {
      await purgeChunks(ctx, lessonId);
      await ctx.runMutation(internal.lessons.deleteLessonDoc, { lessonId });
      throw err;
    }
    return lessonId;
  },
});

// Replaces a lesson's text. Passages whose text is unchanged keep their
// embeddings, so small edits cost almost nothing.
export const update = action({
  args: {
    courseId: v.id("courses"),
    token: v.string(),
    lessonId: v.id("lessons"),
    title: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.runQuery(internal.lessons.checkLesson, {
      courseId: args.courseId,
      token: args.token,
      lessonId: args.lessonId,
    });
    const wordCount = validateInput(args.title, args.text);
    const existing = await ctx.runQuery(internal.lessons.existingChunks, {
      lessonId: args.lessonId,
    });
    const reuse = new Map(existing.map((c) => [embedText(c), c.embedding]));

    // Embed first: if the embedding service fails, the old lesson is untouched.
    const chunks = chunkLesson(args.text);
    const needed = chunks.filter((c) => !reuse.has(embedText(c)));
    await embedTexts(needed.map(embedText), "document");

    await ctx.runMutation(internal.lessons.beginReplace, {
      lessonId: args.lessonId,
      title: args.title.trim(),
      text: args.text,
      wordCount,
    });
    await purgeChunks(ctx, args.lessonId);
    await saveChunks(ctx, args.courseId, args.lessonId, args.text, reuse);
  },
});

export const remove = action({
  args: { courseId: v.id("courses"), token: v.string(), lessonId: v.id("lessons") },
  handler: async (ctx, args): Promise<void> => {
    await ctx.runQuery(internal.lessons.checkLesson, {
      courseId: args.courseId,
      token: args.token,
      lessonId: args.lessonId,
    });
    await purgeChunks(ctx, args.lessonId);
    await ctx.runMutation(internal.lessons.deleteLessonDoc, {
      lessonId: args.lessonId,
    });
  },
});
