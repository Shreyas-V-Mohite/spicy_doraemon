import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionStore } from "./sessionStore";

const sid = (id: string) => id as Id<"sessions">;

export function useConvexStore(): SessionStore {
  const create = useMutation(api.sessions.create);
  const submit = useMutation(api.questions.submit);
  const setVote = useMutation(api.feedback.set);
  const answer = useMutation(api.questions.markAnswered);

  return {
    useSession: (code) => useQuery(api.sessions.getByCode, { code }),
    useProfessorQuestions: (sessionId, token) =>
      useQuery(
        api.questions.listForProfessor,
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

    createSession: (args) => create(args),
    ask: async ({ sessionId, studentId, text }) => {
      await submit({ sessionId: sid(sessionId), studentId, text });
    },
    setFeedback: async ({ sessionId, studentId, value }) => {
      await setVote({ sessionId: sid(sessionId), studentId, value });
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
