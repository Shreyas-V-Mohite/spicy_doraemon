import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionStore } from "./sessionStore";

const sid = (id: string) => id as Id<"sessions">;

export function useConvexStore(): SessionStore {
  const create = useMutation(api.sessions.create);
  const submit = useMutation(api.questions.submit);
  const setVote = useMutation(api.feedback.set);
  const answer = useMutation(api.questions.markAnswered);
  const resetVotes = useMutation(api.feedback.reset);
  const build = useAction(api.visuals.buildPreview);
  const suggest = useAction(api.copilot.suggest);
  const publishPreview = useMutation(api.visuals.publish);
  const unpublishCurrent = useMutation(api.visuals.unpublish);

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
    useMyVote: (sessionId, studentId) =>
      useQuery(
        api.feedback.mine,
        sessionId ? { sessionId: sid(sessionId), studentId } : "skip",
      ),
    useProfessorSuggestions: (sessionId, token) =>
      useQuery(
        api.copilot.listForProfessor,
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

    createSession: (args) => create(args),
    ask: async ({ sessionId, studentId, text }) => {
      await submit({ sessionId: sid(sessionId), studentId, text });
    },
    setFeedback: async ({ sessionId, studentId, value }) => {
      await setVote({ sessionId: sid(sessionId), studentId, value });
    },
    askCopilot: ({ sessionId, token, questionId }) =>
      suggest({
        sessionId: sid(sessionId),
        token,
        questionId: questionId as Id<"questions">,
      }),
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
    markAnswered: async ({ sessionId, token, questionId }) => {
      await answer({
        sessionId: sid(sessionId),
        token,
        questionId: questionId as Id<"questions">,
      });
    },
  };
}
