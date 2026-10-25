import { createContext, useContext } from "react";
import type {
  Course,
  CourseSession,
  FeedbackCounts,
  FeedbackValue,
  Lesson,
  MyQuestion,
  PublicSession,
  LoadedMolecule,
  MoleculeStyle,
  SharedAnswer,
  TranscriptLine,
  QueueCard,
  Signal,
  SignalKind,
  SlideFeedback,
  SlideMolecules,
  RelayChunk,
  Visual,
} from "../types";

// Every read and write of shared classroom state goes through this interface,
// so the Convex implementation can be swapped for another backend.
// Hook members follow React's rules: call them unconditionally.
export interface SessionStore {
  useSession(code: string): PublicSession | null | undefined;
  useProfessorQueue(
    sessionId: string | undefined,
    token: string | null,
  ): QueueCard[] | undefined;
  useMyQuestions(
    sessionId: string | undefined,
    studentId: string,
  ): MyQuestion[] | undefined;
  useFeedbackCounts(sessionId: string | undefined): FeedbackCounts | undefined;
  useMyVote(
    sessionId: string | undefined,
    studentId: string,
  ): FeedbackValue | null | undefined;
  useTranscriptLines(
    sessionId: string | undefined,
    token: string | null,
  ): TranscriptLine[] | undefined;
  // Public: the visual the professor has published, or null.
  useCurrentVisual(sessionId: string | undefined): Visual | null | undefined;
  // Public: the professor's camera on the shared molecule, or null.
  useStageView(sessionId: string | undefined): number[] | null | undefined;
  useSharedAnswer(sessionId: string | undefined): SharedAnswer | null | undefined;
  // The live room.
  useSlidesUrl(sessionId: string | undefined): string | null | undefined;
  useSlideFeedback(
    sessionId: string | undefined,
    token: string | null,
  ): SlideFeedback[] | undefined;
  // Signals waiting for `me` ("professor" needs the token).
  useSignals(
    sessionId: string | undefined,
    me: string,
    token: string | null,
  ): Signal[] | undefined;
  // Professor only: molecules Claude found on each slide.
  useSlideMolecules(
    sessionId: string | undefined,
    token: string | null,
  ): SlideMolecules[] | undefined;
  // Public: the latest relayed camera frame / audio chunk (fallback path).
  useRelay(
    sessionId: string | undefined,
    kind: "video" | "audio",
    active: boolean,
  ): RelayChunk | null | undefined;

  // null means the passcode was wrong.
  useCourses(passcode: string | null): Course[] | null | undefined;
  // null means this browser has no access to the course.
  useCourse(courseId: string, token: string | null): Course | null | undefined;
  useLessons(
    courseId: string | undefined,
    token: string | null,
  ): Lesson[] | undefined;
  useLessonText(
    courseId: string | undefined,
    token: string | null,
    lessonId: string | null,
  ): { title: string; text: string } | undefined;
  useCourseSessions(
    courseId: string | undefined,
    token: string | null,
  ): CourseSession[] | undefined;

  createCourse(args: {
    passcode: string;
    token: string;
    name: string;
  }): Promise<string>;
  claimCourse(args: {
    passcode: string;
    courseId: string;
    token: string;
  }): Promise<void>;
  createLesson(args: {
    courseId: string;
    token: string;
    title: string;
    text: string;
  }): Promise<void>;
  updateLesson(args: {
    courseId: string;
    token: string;
    lessonId: string;
    title: string;
    text: string;
  }): Promise<void>;
  deleteLesson(args: {
    courseId: string;
    token: string;
    lessonId: string;
  }): Promise<void>;
  createSession(args: {
    courseId: string;
    token: string;
    topic: string;
  }): Promise<{ sessionId: string; code: string }>;
  ask(args: { sessionId: string; studentId: string; text: string }): Promise<void>;
  setFeedback(args: {
    sessionId: string;
    studentId: string;
    value: FeedbackValue;
  }): Promise<void>;
  // Loads a molecule for the professor's own stage; nothing is shared.
  loadMolecule(args: {
    sessionId: string;
    token: string;
    kind: "name" | "smiles";
    value: string;
  }): Promise<LoadedMolecule>;
  // Shares with the class; the server re-verifies the highlight.
  shareMolecule(args: {
    sessionId: string;
    token: string;
    kind: "name" | "smiles";
    value: string;
    groupId?: string;
    style: MoleculeStyle;
    // false: show it beside the slides without switching the stage to 3D.
    toStage?: boolean;
  }): Promise<void>;
  unshareMolecule(args: { sessionId: string; token: string }): Promise<void>;
  setStageView(args: { sessionId: string; token: string; view: number[] }): Promise<void>;
  shareAnswer(args: {
    sessionId: string;
    token: string;
    questionId: string;
  }): Promise<void>;
  stopSharingAnswer(args: { sessionId: string; token: string }): Promise<void>;
  resetFeedback(args: { sessionId: string; token: string }): Promise<void>;
  addTranscriptLine(args: {
    sessionId: string;
    token: string;
    text: string;
  }): Promise<void>;
  editTranscriptLine(args: {
    sessionId: string;
    token: string;
    lineId: string;
    text: string;
  }): Promise<void>;
  deleteTranscriptLine(args: {
    sessionId: string;
    token: string;
    lineId: string;
  }): Promise<void>;
  setTranscribing(args: {
    sessionId: string;
    token: string;
    on: boolean;
  }): Promise<void>;
  flushTranscript(args: { sessionId: string; token: string }): Promise<void>;
  clearTranscript(args: { sessionId: string; token: string }): Promise<void>;
  markGroupAnswered(args: {
    sessionId: string;
    token: string;
    groupId: string;
  }): Promise<void>;
  splitFromGroup(args: {
    sessionId: string;
    token: string;
    questionId: string;
  }): Promise<void>;
  markAnswered(args: {
    sessionId: string;
    token: string;
    questionId: string;
  }): Promise<void>;
  // The student still wants the professor after the AI answer.
  escalateQuestion(args: {
    sessionId: string;
    studentId: string;
    questionId: string;
    note?: string;
  }): Promise<void>;
  replyToQuestion(args: {
    sessionId: string;
    token: string;
    questionId: string;
    text: string;
  }): Promise<void>;
  // Uploads a PDF deck and puts it on the session.
  uploadSlides(args: {
    sessionId: string;
    token: string;
    file: File;
    slideCount: number;
  }): Promise<void>;
  setSlide(args: { sessionId: string; token: string; slideIndex: number }): Promise<void>;
  setStageMode(args: {
    sessionId: string;
    token: string;
    stageMode: "slides" | "molecule";
  }): Promise<void>;
  setHandMode(args: { sessionId: string; token: string; on: boolean }): Promise<void>;
  setBroadcasting(args: { sessionId: string; token: string; on: boolean }): Promise<void>;
  sendSignal(args: {
    sessionId: string;
    from: string;
    to: string;
    kind: SignalKind;
    payload: string;
    token?: string;
  }): Promise<void>;
  ackSignals(args: {
    sessionId: string;
    me: string;
    token?: string;
    ids: string[];
  }): Promise<void>;
  getIceServers(): Promise<RTCIceServer[]>;
  requestRelay(args: { sessionId: string }): Promise<void>;
  pushRelay(args: {
    sessionId: string;
    token: string;
    kind: "video" | "audio";
    seq: number;
    data: ArrayBuffer;
  }): Promise<void>;
  detectSlideMolecules(args: {
    sessionId: string;
    token: string;
    slideIndex: number;
    image: string;
    text: string;
  }): Promise<void>;
}

export const StoreContext = createContext<SessionStore | null>(null);

export function useStore(): SessionStore {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("StoreContext.Provider is missing");
  return store;
}
