import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx } from "./_generated/server";
import { embedTexts } from "./lib/embed";

// A stretch of the professor's material that an answer may quote.
export interface Passage {
  source: "lesson" | "transcript";
  chunkId: Id<"lessonChunks"> | Id<"transcriptChunks"> | null;
  // Where it came from, shown to students next to the quote.
  label: string;
  text: string;
  score: number;
  // Lecture passages only: which session, and when the stretch ended.
  sessionId?: Id<"sessions">;
  endedAt?: number;
}

export const hydrate = internalQuery({
  args: { ids: v.array(v.id("lessonChunks")) },
  handler: async (ctx, args) => {
    const out = [];
    for (const id of args.ids) {
      const chunk = await ctx.db.get(id);
      if (chunk) {
        const lesson = await ctx.db.get(chunk.lessonId);
        const title = lesson?.title ?? "Lesson";
        out.push({
          chunkId: chunk._id,
          label: chunk.heading ? `${title} › ${chunk.heading}` : title,
          text: chunk.text,
        });
      }
    }
    return out;
  },
});

// Top passages from the course's lessons and from every lecture transcript
// in the course (this session and earlier ones), most similar first.
export async function searchCourse(
  ctx: ActionCtx,
  courseId: Id<"courses">,
  vector: number[],
  limits: { lessons: number; transcript: number } = { lessons: 5, transcript: 3 },
): Promise<Passage[]> {
  const [lessonHits, lectureHits] = await Promise.all([
    ctx.vectorSearch("lessonChunks", "by_embedding", {
      vector,
      limit: limits.lessons,
      filter: (q) => q.eq("courseId", courseId),
    }),
    ctx.vectorSearch("transcriptChunks", "by_embedding", {
      vector,
      limit: limits.transcript,
      filter: (q) => q.eq("courseId", courseId),
    }),
  ]);
  const [lessonDocs, lectureDocs]: [
    { chunkId: Id<"lessonChunks">; label: string; text: string }[],
    {
      chunkId: Id<"transcriptChunks">;
      sessionId: Id<"sessions">;
      endedAt: number;
      text: string;
      label: string;
    }[],
  ] = await Promise.all([
    ctx.runQuery(internal.retrieval.hydrate, { ids: lessonHits.map((h) => h._id) }),
    ctx.runQuery(internal.transcript.hydrateChunks, {
      ids: lectureHits.map((h) => h._id),
    }),
  ]);
  const lessonById = new Map(lessonDocs.map((d) => [d.chunkId, d]));
  const lectureById = new Map(lectureDocs.map((d) => [d.chunkId, d]));

  const passages: Passage[] = [];
  for (const h of lessonHits) {
    const d = lessonById.get(h._id);
    if (d) {
      passages.push({
        source: "lesson",
        chunkId: d.chunkId,
        label: d.label,
        text: d.text,
        score: h._score,
      });
    }
  }
  for (const h of lectureHits) {
    const d = lectureById.get(h._id);
    if (d) {
      passages.push({
        source: "transcript",
        chunkId: d.chunkId,
        label: d.label,
        text: d.text,
        score: h._score,
        sessionId: d.sessionId,
        endedAt: d.endedAt,
      });
    }
  }
  return passages.sort((a, b) => b.score - a.score);
}

// For checking retrieval quality from the CLI.
export const search = internalAction({
  args: { courseId: v.id("courses"), question: v.string() },
  handler: async (ctx, args) => {
    const [vector] = await embedTexts([args.question], "query");
    const passages = await searchCourse(ctx, args.courseId, vector);
    return passages.map((p) => ({
      score: Number(p.score.toFixed(3)),
      source: p.source,
      label: p.label,
      start: p.text.slice(0, 70),
    }));
  },
});
