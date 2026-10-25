import { createContext, useContext } from "react";
import type {
  FeedbackCounts,
  FeedbackValue,
  PublicSession,
  Preview,
  Question,
  Suggestion,
  Visual,
} from "../types";

// Every read and write of shared classroom state goes through this interface,
// so the Convex implementation can be swapped for another backend.
// Hook members follow React's rules: call them unconditionally.
export interface SessionStore {
  useSession(code: string): PublicSession | null | undefined;
  useProfessorQuestions(
    sessionId: string | undefined,
    token: string | null,
  ): Question[] | undefined;
  useMyQuestions(
    sessionId: string | undefined,
    studentId: string,
  ): Question[] | undefined;
  useFeedbackCounts(sessionId: string | undefined): FeedbackCounts | undefined;
  useProfessorSuggestions(
    sessionId: string | undefined,
    token: string | null,
  ): Suggestion[] | undefined;
  // Public: the visual the professor has published, or null.
  useCurrentVisual(sessionId: string | undefined): Visual | null | undefined;
  useProfessorPreviews(
    sessionId: string | undefined,
    token: string | null,
  ): Preview[] | undefined;

  createSession(args: {
    passcode: string;
    token: string;
    topic: string;
  }): Promise<{ sessionId: string; code: string }>;
  ask(args: { sessionId: string; studentId: string; text: string }): Promise<void>;
  setFeedback(args: {
    sessionId: string;
    studentId: string;
    value: FeedbackValue;
  }): Promise<void>;
  askCopilot(args: {
    sessionId: string;
    token: string;
    questionId: string;
  }): Promise<string>;
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
