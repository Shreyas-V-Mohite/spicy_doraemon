import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { visualFields } from "./lib/visual";

export default defineSchema({
  // Public fields are code and topic; tokenHash never leaves the server.
  sessions: defineTable({
    code: v.string(),
    topic: v.string(),
    courseId: v.optional(v.id("courses")),
    // True while the professor's browser is transcribing; students are told.
    transcribing: v.optional(v.boolean()),
    // True while a background job is waiting to turn new lines into passages.
    flushPending: v.optional(v.boolean()),
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
    // Set when a similar question from this session was found.
    groupId: v.optional(v.id("questionGroups")),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_and_student", ["sessionId", "studentId"])
    .index("by_group", ["groupId"]),

  // Embeddings of questions, kept apart so reading questions stays light.
  questionVectors: defineTable({
    questionId: v.id("questions"),
    sessionId: v.id("sessions"),
    embedding: v.array(v.float64()),
  })
    .index("by_question", ["questionId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["sessionId"],
    }),

  // Similar questions in one session. Groups with one question don't exist.
  questionGroups: defineTable({
    sessionId: v.id("sessions"),
    firstQuestionId: v.id("questions"),
    label: v.optional(v.string()),
  }).index("by_session", ["sessionId"]),

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
          source: v.optional(v.union(v.literal("lesson"), v.literal("transcript"))),
          chunkId: v.optional(
            v.union(v.id("lessonChunks"), v.id("transcriptChunks")),
          ),
          label: v.string(),
          text: v.string(),
        }),
      ),
    ),
    note: v.optional(v.string()),
    // True when the lecture contradicted the lesson (the lesson was used).
    conflict: v.optional(v.boolean()),
    // Set when the answer was copied from a near-identical earlier question.
    reusedFrom: v.optional(v.id("questions")),
    topScore: v.optional(v.number()),
    retrievalMs: v.optional(v.number()),
    claudeMs: v.optional(v.number()),
    totalMs: v.optional(v.number()),
  })
    .index("by_question", ["questionId"])
    .index("by_session", ["sessionId"]),

  // What the professor said, one row per finished phrase. Editable.
  transcriptLines: defineTable({
    sessionId: v.id("sessions"),
    courseId: v.id("courses"),
    text: v.string(),
    startedAt: v.number(),
    // Set once the line is part of a searchable chunk.
    chunkId: v.optional(v.id("transcriptChunks")),
  })
    .index("by_session", ["sessionId"])
    .index("by_chunk", ["chunkId"]),

  // Searchable stretches of lecture (about 60-120 words) with embeddings.
  transcriptChunks: defineTable({
    courseId: v.id("courses"),
    sessionId: v.id("sessions"),
    text: v.string(),
    startedAt: v.number(),
    endedAt: v.number(),
    embedding: v.array(v.float64()),
  })
    .index("by_session", ["sessionId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["courseId"],
    }),
});
