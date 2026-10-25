import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
});
