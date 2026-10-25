import { v } from "convex/values";

// A verified quote shown to a student, with where it came from.
export const quoteValidator = v.object({
  source: v.optional(v.union(v.literal("lesson"), v.literal("transcript"))),
  chunkId: v.optional(v.union(v.id("lessonChunks"), v.id("transcriptChunks"))),
  label: v.string(),
  text: v.string(),
});
