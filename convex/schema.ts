import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { visualFields } from "./lib/visual";

export default defineSchema({
  // Public fields are code and topic; tokenHash never leaves the server.
  sessions: defineTable({
    code: v.string(),
    topic: v.string(),
    tokenHash: v.string(),
  }).index("by_code", ["code"]),

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
});
