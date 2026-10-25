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
  const load = useAction(api.visuals.load);
  const share = useAction(api.visuals.share);
  const unshare = useMutation(api.visuals.unshare);
  const sendView = useMutation(api.visuals.setView);
  const shareQa = useMutation(api.sharing.shareAnswer);
  const stopQa = useMutation(api.sharing.stopSharingAnswer);
  const slidesUploadUrl = useMutation(api.live.generateSlidesUploadUrl);
  const attachSlides = useMutation(api.live.attachSlides);
  const gotoSlide = useMutation(api.live.setSlide);
  const stageMode = useMutation(api.live.setStageMode);
  const handMode = useMutation(api.live.setHandMode);
  const onAir = useMutation(api.live.setBroadcasting);
  const signal = useMutation(api.live.sendSignal);
  const ack = useMutation(api.live.ackSignals);
  const ice = useAction(api.live.iceServers);
  const askRelay = useMutation(api.live.requestRelay);
  const sendRelay = useMutation(api.live.pushRelay);
  const detect = useAction(api.slideAi.detect);
  const escalate = useMutation(api.questions.escalate);
  const reply = useMutation(api.questions.reply);

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
    useStageView: (sessionId) =>
      useQuery(
        api.visuals.currentView,
        sessionId ? { sessionId: sid(sessionId) } : "skip",
      ),
    useSlidesUrl: (sessionId) =>
      useQuery(api.live.slidesUrl, sessionId ? { sessionId: sid(sessionId) } : "skip"),
    useSlideFeedback: (sessionId, token) =>
      useQuery(
        api.feedback.bySlide,
        sessionId && token ? { sessionId: sid(sessionId), token } : "skip",
      ),
    useSignals: (sessionId, me, token) =>
      useQuery(
        api.live.inbox,
        sessionId && (me !== "professor" || token)
          ? { sessionId: sid(sessionId), me, token: token ?? undefined }
          : "skip",
      ),
    useSlideMolecules: (sessionId, token) =>
      useQuery(
        api.slideAi.list,
        sessionId && token ? { sessionId: sid(sessionId), token } : "skip",
      ),
    useRelay: (sessionId, kind, active) =>
      useQuery(api.live.relay, sessionId && active ? { sessionId: sid(sessionId), kind } : "skip"),
    useSharedAnswer: (sessionId) =>
      useQuery(
        api.sharing.currentAnswer,
        sessionId ? { sessionId: sid(sessionId) } : "skip",
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
    loadMolecule: ({ sessionId, token, kind, value }) =>
      load({ sessionId: sid(sessionId), token, kind, value }),
    shareMolecule: async ({ sessionId, token, kind, value, groupId, style, toStage }) => {
      await share({ sessionId: sid(sessionId), token, kind, value, groupId, style, toStage });
    },
    unshareMolecule: async ({ sessionId, token }) => {
      await unshare({ sessionId: sid(sessionId), token });
    },
    setStageView: async ({ sessionId, token, view }) => {
      await sendView({ sessionId: sid(sessionId), token, view });
    },
    shareAnswer: async ({ sessionId, token, questionId }) => {
      await shareQa({
        sessionId: sid(sessionId),
        token,
        questionId: questionId as Id<"questions">,
      });
    },
    stopSharingAnswer: async ({ sessionId, token }) => {
      await stopQa({ sessionId: sid(sessionId), token });
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
    escalateQuestion: async ({ sessionId, questionId, ...rest }) => {
      await escalate({ sessionId: sid(sessionId), questionId: questionId as Id<"questions">, ...rest });
    },
    replyToQuestion: async ({ sessionId, questionId, ...rest }) => {
      await reply({ sessionId: sid(sessionId), questionId: questionId as Id<"questions">, ...rest });
    },
    uploadSlides: async ({ sessionId, token, file, slideCount }) => {
      const url = await slidesUploadUrl({ sessionId: sid(sessionId), token });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: string };
      await attachSlides({
        sessionId: sid(sessionId),
        token,
        fileId: storageId as Id<"_storage">,
        slideCount,
      });
    },
    setSlide: async ({ sessionId, token, slideIndex }) => {
      await gotoSlide({ sessionId: sid(sessionId), token, slideIndex });
    },
    setStageMode: async ({ sessionId, token, stageMode: mode }) => {
      await stageMode({ sessionId: sid(sessionId), token, stageMode: mode });
    },
    setHandMode: async ({ sessionId, token, on }) => {
      await handMode({ sessionId: sid(sessionId), token, on });
    },
    setBroadcasting: async ({ sessionId, token, on }) => {
      await onAir({ sessionId: sid(sessionId), token, on });
    },
    sendSignal: async ({ sessionId, ...rest }) => {
      await signal({ sessionId: sid(sessionId), ...rest });
    },
    ackSignals: async ({ sessionId, ids, ...rest }) => {
      await ack({ sessionId: sid(sessionId), ids: ids as Id<"rtcSignals">[], ...rest });
    },
    getIceServers: async () => (await ice({})) as RTCIceServer[],
    requestRelay: async ({ sessionId }) => {
      await askRelay({ sessionId: sid(sessionId) });
    },
    pushRelay: async ({ sessionId, ...rest }) => {
      await sendRelay({ sessionId: sid(sessionId), ...rest });
    },
    detectSlideMolecules: async ({ sessionId, ...rest }) => {
      await detect({ sessionId: sid(sessionId), ...rest });
    },
  };
}
