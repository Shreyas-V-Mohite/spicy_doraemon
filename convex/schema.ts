import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { visualFields } from "./lib/visual";

export default defineSchema({
  // Public fields are code and topic; tokenHash never leaves the server.
  sessions: defineTable({
    code: v.string(),
    topic: v.string(),
    courseId: v.optional(v.id("courses")),
    // Sessions without a course (created before courses existed) keep their own.
    tokenHash: v.optional(v.string()),
  }).index("by_code", ["code"]),

  // The professor's identity: a hash of each browser token allowed to manage it.
  courses: defineTable({
    name: v.string(),
    tokenHashes: v.array(v.string()),
  }),

  lessons: defineTable({
    courseId: v.id("courses"),
    title: v.string(),
    text: v.string(),
    wordCount: v.number(),
    chunkCount: v.number(),
    status: v.union(v.literal("saving"), v.literal("ready")),
  }).index("by_course", ["courseId"]),

  // Searchable passages. `text` is exactly what quotes are verified against;
  // the embedding also covers the heading.
  lessonChunks: defineTable({
    courseId: v.id("courses"),
    lessonId: v.id("lessons"),
    ordinal: v.number(),
    heading: v.string(),
    text: v.string(),
    embedding: v.array(v.float64()),
  })
    .index("by_lesson", ["lessonId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["courseId"],
    }),

  // studentId is a random id generated in the student's browser.
  questions: defineTable({
    sessionId: v.id("sessions"),
    studentId: v.string(),
    text: v.string(),
    status: v.union(v.literal("open"), v.literal("answered")),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_and_student", ["sessionId", "studentId"]),

  feedback: defineTable({
    sessionId: v.id("sessions"),
    studentId: v.string(),
    value: v.union(v.literal("confused"), v.literal("understood")),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_and_student", ["sessionId", "studentId"]),

  // Professor only: built from the chemistry service, not yet visible to students.
  previews: defineTable(visualFields).index("by_session", ["sessionId"]),

  // Public: at most one current visual per session.
  published_visuals: defineTable(visualFields).index("by_session", ["sessionId"]),

  // Professor only: the copilot's answer to one question. previewId is set
  // only when the chemistry service verified the proposed highlight.
  suggestions: defineTable({
    sessionId: v.id("sessions"),
    questionId: v.id("questions"),
    explanation: v.string(),
    sourceIds: v.array(v.string()),
    teachingAction: v.string(),
    molecule: v.optional(v.string()),
    groupId: v.optional(v.string()),
    previewId: v.optional(v.id("previews")),
    note: v.optional(v.string()),
    cached: v.boolean(),
  })
    .index("by_session", ["sessionId"])
    .index("by_question", ["questionId"]),

  // A student's answer, created "pending" with the question and filled in by
  // an action. Students read text and quotes only; note/timings are for the
  // professor.
  answers: defineTable({
    sessionId: v.id("sessions"),
    questionId: v.id("questions"),
    status: v.union(
      v.literal("pending"),
      v.literal("answered"),
      v.literal("fallback"),
      v.literal("not_covered"),
      v.literal("failed"),
    ),
    text: v.optional(v.string()),
    quotes: v.optional(
      v.array(
        v.object({
          chunkId: v.id("lessonChunks"),
          label: v.string(),
          text: v.string(),
        }),
      ),
    ),
    note: v.optional(v.string()),
    topScore: v.optional(v.number()),
    retrievalMs: v.optional(v.number()),
    claudeMs: v.optional(v.number()),
    totalMs: v.optional(v.number()),
  })
    .index("by_question", ["questionId"])
    .index("by_session", ["sessionId"]),
});
