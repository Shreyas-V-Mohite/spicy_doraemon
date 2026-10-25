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
    // The live room. Slides are one PDF; everyone sees page slideIndex (0-based).
    slidesFileId: v.optional(v.id("_storage")),
    slideCount: v.optional(v.number()),
    slideIndex: v.optional(v.number()),
    // What the shared stage shows: the slides or the 3D molecule.
    stageMode: v.optional(v.union(v.literal("slides"), v.literal("molecule"))),
    // True while the professor's camera/mic is on air. liveEpoch goes up each
    // time it starts, so students' browsers know to (re)connect.
    broadcasting: v.optional(v.boolean()),
    liveEpoch: v.optional(v.number()),
    // True while the professor is turning the shared molecule by hand: the
    // camera with the molecule over it takes the main screen for everyone.
    handMode: v.optional(v.boolean()),
    // Until this time (ms) some student can't get a direct connection, so the
    // professor's page also sends low-rate frames and audio through Convex.
    relayUntil: v.optional(v.number()),
  }).index("by_code", ["code"]),

  // Fallback media for students whose network blocks WebRTC: the latest
  // camera frame (JPEG) and the latest audio chunk (16 kHz PCM), overwritten.
  relay: defineTable({
    sessionId: v.id("sessions"),
    kind: v.union(v.literal("video"), v.literal("audio")),
    seq: v.number(),
    data: v.bytes(),
  }).index("by_session_and_kind", ["sessionId", "kind"]),

  // Molecules Claude found on each slide, so the gesture button can put the
  // one being taught on stage.
  slideMolecules: defineTable({
    sessionId: v.id("sessions"),
    slideIndex: v.number(),
    // The deck it was read from; a new upload makes old results stale.
    fileId: v.id("_storage"),
    molecules: v.array(v.object({ name: v.string(), smiles: v.string() })),
  }).index("by_session_and_slideIndex", ["sessionId", "slideIndex"]),

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
    // The slide on screen when it was asked, if the session has slides.
    slideIndex: v.optional(v.number()),
    // The student read the AI's answer and still wants the professor: when,
    // and what is still unclear (optional).
    escalatedAt: v.optional(v.number()),
    escalationNote: v.optional(v.string()),
    // The professor's own reply, shown to this student only.
    professorReply: v.optional(v.string()),
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

  // One vote per student per slide (slideIndex unset when there are no slides),
  // so the professor can see which slides lost the class.
  feedback: defineTable({
    sessionId: v.id("sessions"),
    studentId: v.string(),
    value: v.union(v.literal("confused"), v.literal("understood")),
    slideIndex: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_and_student", ["sessionId", "studentId"])
    .index("by_session_and_slideIndex_and_studentId", ["sessionId", "slideIndex", "studentId"]),

  // WebRTC signalling for the professor's camera: offers, answers and ICE
  // candidates passed between browsers, deleted by the recipient once read.
  // Peer ids are "professor" or a student's browser id.
  rtcSignals: defineTable({
    sessionId: v.id("sessions"),
    from: v.string(),
    to: v.string(),
    kind: v.union(
      v.literal("join"),
      v.literal("offer"),
      v.literal("answer"),
      v.literal("ice"),
      v.literal("leave"),
    ),
    payload: v.string(),
  }).index("by_session_and_to", ["sessionId", "to"]),

  // Public: at most one molecule shared with the class per session.
  published_visuals: defineTable(visualFields).index("by_session", ["sessionId"]),

  // Public, high-churn: the professor's camera on the shared molecule (3Dmol's
  // getView array), so students' viewers can follow it. Kept apart from
  // published_visuals so frequent updates don't resend the structure.
  stageViews: defineTable({
    sessionId: v.id("sessions"),
    view: v.array(v.number()),
  }).index("by_session", ["sessionId"]),

  // Public: at most one answer shared with the class per session. A snapshot,
  // anonymous: the question text and what the student was shown, nothing else.
  sharedAnswers: defineTable({
    sessionId: v.id("sessions"),
    question: v.string(),
    answer: v.string(),
    quotes: v.array(v.object({ label: v.string(), text: v.string() })),
  }).index("by_session", ["sessionId"]),

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
