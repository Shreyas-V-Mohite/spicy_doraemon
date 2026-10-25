import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionStore } from "./sessionStore";

const sid = (id: string) => id as Id<"sessions">;
const cid = (id: string) => id as Id<"courses">;

export function useConvexStore(): SessionStore {
  const create = useMutation(api.sessions.create);
  const makeCourse = useMutation(api.courses.create);
  const claim = useMutation(api.courses.claim);
  const addLesson = useAction(api.lessons.create);
  const editLesson = useAction(api.lessons.update);
  const dropLesson = useAction(api.lessons.remove);
  const submit = useMutation(api.questions.submit);
  const setVote = useMutation(api.feedback.set);
  const answer = useMutation(api.questions.markAnswered);
  const answerGroup = useMutation(api.questions.markGroupAnswered);
  const split = useMutation(api.questions.splitFromGroup);
  const addLine = useMutation(api.transcript.addLine);
  const editLine = useMutation(api.transcript.editLine);
  const deleteLine = useMutation(api.transcript.deleteLine);
  const setLive = useMutation(api.transcript.setTranscribing);
  const flush = useAction(api.transcript.flushNow);
  const clear = useAction(api.transcript.clear);
  const resetVotes = useMutation(api.feedback.reset);
  const build = useAction(api.visuals.buildPreview);
  const publishPreview = useMutation(api.visuals.publish);
  const unpublishCurrent = useMutation(api.visuals.unpublish);

  return {
    useSession: (code) => useQuery(api.sessions.getByCode, { code }),
    useProfessorQueue: (sessionId, token) =>
      useQuery(
        api.questions.queue,
        sessionId && token ? { sessionId: sid(sessionId), token } : "skip",
      ),
    useMyQuestions: (sessionId, studentId) =>
      useQuery(
        api.questions.listMine,
        sessionId ? { sessionId: sid(sessionId), studentId } : "skip",
      ),
    useFeedbackCounts: (sessionId) =>
      useQuery(
        api.feedback.counts,
        sessionId ? { sessionId: sid(sessionId) } : "skip",
      ),
    useCourses: (passcode) =>
      useQuery(api.courses.list, passcode ? { passcode } : "skip"),
    useCourse: (courseId, token) =>
      useQuery(
        api.courses.get,
        token ? { courseId: cid(courseId), token } : "skip",
      ),
    useLessons: (courseId, token) =>
      useQuery(
        api.lessons.list,
        courseId && token ? { courseId: cid(courseId), token } : "skip",
      ),
    useLessonText: (courseId, token, lessonId) =>
      useQuery(
        api.lessons.getText,
        courseId && token && lessonId
          ? {
              courseId: cid(courseId),
              token,
              lessonId: lessonId as Id<"lessons">,
            }
          : "skip",
      ),
    useCourseSessions: (courseId, token) =>
      useQuery(
        api.sessions.listForCourse,
        courseId && token ? { courseId: cid(courseId), token } : "skip",
      ),
    useMyVote: (sessionId, studentId) =>
      useQuery(
        api.feedback.mine,
        sessionId ? { sessionId: sid(sessionId), studentId } : "skip",
      ),
    useTranscriptLines: (sessionId, token) =>
      useQuery(
        api.transcript.lines,
        sessionId && token ? { sessionId: sid(sessionId), token } : "skip",
      ),
    useCurrentVisual: (sessionId) =>
      useQuery(
        api.visuals.current,
        sessionId ? { sessionId: sid(sessionId) } : "skip",
      ),
    useProfessorPreviews: (sessionId, token) =>
      useQuery(
        api.visuals.listPreviews,
        sessionId && token ? { sessionId: sid(sessionId), token } : "skip",
      ),

    createCourse: (args) => makeCourse(args),
    claimCourse: async ({ passcode, courseId, token }) => {
      await claim({ passcode, courseId: cid(courseId), token });
    },
    createLesson: async ({ courseId, token, title, text }) => {
      await addLesson({ courseId: cid(courseId), token, title, text });
    },
    updateLesson: async ({ courseId, token, lessonId, title, text }) => {
      await editLesson({
        courseId: cid(courseId),
        token,
        lessonId: lessonId as Id<"lessons">,
        title,
        text,
      });
    },
    deleteLesson: async ({ courseId, token, lessonId }) => {
      await dropLesson({
        courseId: cid(courseId),
        token,
        lessonId: lessonId as Id<"lessons">,
      });
    },
    createSession: ({ courseId, token, topic }) =>
      create({ courseId: cid(courseId), token, topic }),
    ask: async ({ sessionId, studentId, text }) => {
      await submit({ sessionId: sid(sessionId), studentId, text });
    },
    setFeedback: async ({ sessionId, studentId, value }) => {
      await setVote({ sessionId: sid(sessionId), studentId, value });
    },
    buildPreview: ({ sessionId, token, query, groupId }) =>
      build({ sessionId: sid(sessionId), token, query, groupId }),
    publish: async ({ sessionId, token, previewId }) => {
      await publishPreview({
        sessionId: sid(sessionId),
        token,
        previewId: previewId as Id<"previews">,
      });
    },
    unpublish: async ({ sessionId, token }) => {
      await unpublishCurrent({ sessionId: sid(sessionId), token });
    },
    resetFeedback: async ({ sessionId, token }) => {
      await resetVotes({ sessionId: sid(sessionId), token });
    },
    addTranscriptLine: async ({ sessionId, token, text }) => {
      await addLine({ sessionId: sid(sessionId), token, text });
    },
    editTranscriptLine: async ({ sessionId, token, lineId, text }) => {
      await editLine({
        sessionId: sid(sessionId),
        token,
        lineId: lineId as Id<"transcriptLines">,
        text,
      });
    },
    deleteTranscriptLine: async ({ sessionId, token, lineId }) => {
      await deleteLine({
        sessionId: sid(sessionId),
        token,
        lineId: lineId as Id<"transcriptLines">,
      });
    },
    setTranscribing: async ({ sessionId, token, on }) => {
      await setLive({ sessionId: sid(sessionId), token, on });
    },
    flushTranscript: async ({ sessionId, token }) => {
      await flush({ sessionId: sid(sessionId), token });
    },
    clearTranscript: async ({ sessionId, token }) => {
      await clear({ sessionId: sid(sessionId), token });
    },
    markGroupAnswered: async ({ sessionId, token, groupId }) => {
      await answerGroup({
        sessionId: sid(sessionId),
        token,
        groupId: groupId as Id<"questionGroups">,
      });
    },
    splitFromGroup: async ({ sessionId, token, questionId }) => {
      await split({
        sessionId: sid(sessionId),
        token,
        questionId: questionId as Id<"questions">,
      });
    },
    markAnswered: async ({ sessionId, token, questionId }) => {
      await answer({
        sessionId: sid(sessionId),
        token,
        questionId: questionId as Id<"questions">,
      });
    },
  };
}
