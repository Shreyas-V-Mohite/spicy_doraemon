import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx } from "./_generated/server";
import { embedTexts } from "./lib/embed";

export interface Passage {
  chunkId: Id<"lessonChunks">;
  lessonId: Id<"lessons">;
  heading: string;
  text: string;
  score: number;
}

export const hydrate = internalQuery({
  args: { ids: v.array(v.id("lessonChunks")) },
  handler: async (ctx, args) => {
    const out = [];
    for (const id of args.ids) {
      const chunk = await ctx.db.get(id);
      if (chunk) {
        out.push({
          chunkId: chunk._id,
          lessonId: chunk.lessonId,
          heading: chunk.heading,
          text: chunk.text,
        });
      }
    }
    return out;
  },
});

// Top passages from every lesson in the course, most similar first.
export async function searchLessons(
  ctx: ActionCtx,
  courseId: Id<"courses">,
  question: string,
  limit = 6,
): Promise<Passage[]> {
  const [vector] = await embedTexts([question], "query");
  const hits = await ctx.vectorSearch("lessonChunks", "by_embedding", {
    vector,
    limit,
    filter: (q) => q.eq("courseId", courseId),
  });
  const docs = await ctx.runQuery(internal.retrieval.hydrate, {
    ids: hits.map((h) => h._id),
  });
  const byId = new Map(docs.map((d) => [d.chunkId, d]));
  return hits.flatMap((h) => {
    const doc = byId.get(h._id);
    return doc ? [{ ...doc, score: h._score }] : [];
  });
}

// For checking retrieval quality from the CLI.
export const search = internalAction({
  args: { courseId: v.id("courses"), question: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const passages = await searchLessons(ctx, args.courseId, args.question, args.limit);
    return passages.map((p) => ({
      score: Number(p.score.toFixed(3)),
      heading: p.heading,
      words: p.text.split(/\s+/).length,
      start: p.text.slice(0, 70),
    }));
  },
});
