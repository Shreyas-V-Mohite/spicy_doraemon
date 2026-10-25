import { createContext, useContext } from "react";
import type {
  Course,
  CourseSession,
  FeedbackCounts,
  FeedbackValue,
  Lesson,
  MyQuestion,
  PublicSession,
  Preview,
  TranscriptLine,
  QueueCard,
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
  useProfessorPreviews(
    sessionId: string | undefined,
    token: string | null,
  ): Preview[] | undefined;

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
  buildPreview(args: {
    sessionId: string;
    token: string;
    query: string;
    groupId: string;
  }): Promise<string>;
  publish(args: {
    sessionId: string;
    token: string;
    previewId: string;
  }): Promise<void>;
  unpublish(args: { sessionId: string; token: string }): Promise<void>;
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
}

export const StoreContext = createContext<SessionStore | null>(null);

export function useStore(): SessionStore {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("StoreContext.Provider is missing");
  return store;
}
