import { Link, useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { useState } from "react";
import { errorMessage, getProfessorToken } from "../lib/identity";
import { EXCERPTS } from "../../../../convex/lib/lesson";
import type { Suggestion } from "../types";
import VisualPanel from "./VisualPanel";

export default function Professor() {
  const { code = "" } = useParams();
  const store = useStore();
  const session = store.useSession(code);
  const token = getProfessorToken(code);
  const questions = store.useProfessorQuestions(session?._id, token);
  const counts = store.useFeedbackCounts(session?._id);
  const suggestions = store.useProfessorSuggestions(session?._id, token);
  const [chosenPreview, setChosenPreview] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [copilotError, setCopilotError] = useState<string | null>(null);

  if (session === undefined) return <main className="page">Loading…</main>;
  if (session === null) {
    return (
      <main className="page">
        <p>No session with code {code}.</p>
        <Link to="/professor">Start a new one</Link>
      </main>
    );
  }
  if (token === null) {
    return (
      <main className="page">
        <p>This browser isn't the professor for session {code}.</p>
        <Link to="/professor">Start a new session</Link>
      </main>
    );
  }

  async function askCopilot(questionId: string) {
    if (!session || !token) return;
    setAsking(questionId);
    setCopilotError(null);
    try {
      await store.askCopilot({ sessionId: session._id, token, questionId });
    } catch (err) {
      setCopilotError(errorMessage(err));
    } finally {
      setAsking(null);
    }
  }

  const latestFor = (questionId: string): Suggestion | undefined =>
    suggestions?.find((s) => s.questionId === questionId);

  const open = questions?.filter((q) => q.status === "open") ?? [];
  const answered = questions?.filter((q) => q.status === "answered") ?? [];

  return (
    <main className="page">
      <header className="bar">
        <div>
          <h1>{session.topic}</h1>
          <p className="muted">
            Join code <strong className="code">{session.code}</strong> ·{" "}
            <Link to={`/present/${session.code}`} target="_blank">
              Open presentation view
            </Link>
          </p>
        </div>
        <div className="counts">
          <span className="pill confused">Confused {counts?.confused ?? 0}</span>
          <span className="pill understood">
            Understood {counts?.understood ?? 0}
          </span>
        </div>
      </header>

      <div className="columns">
        <section>
          <h2>Question queue ({open.length})</h2>
          {questions === undefined && <p className="muted">Loading…</p>}
          {questions && open.length === 0 && (
            <p className="muted">No open questions yet.</p>
          )}
          <ul className="list">
            {open.map((q) => (
              <li key={q._id}>
                <p>{q.text}</p>
                <div className="row">
                  <button
                    disabled={asking !== null}
                    onClick={() => askCopilot(q._id)}
                  >
                    {asking === q._id ? "Thinking…" : "Ask copilot"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      store.markAnswered({
                        sessionId: session._id,
                        token,
                        questionId: q._id,
                      })
                    }
                  >
                    Mark answered
                  </button>
                </div>
                {latestFor(q._id) && (
                  <SuggestionCard
                    suggestion={latestFor(q._id)!}
                    onOpenPreview={setChosenPreview}
                  />
                )}
              </li>
            ))}
          </ul>
          {copilotError && <p className="error">{copilotError}</p>}
          {answered.length > 0 && (
            <details>
              <summary>Answered ({answered.length})</summary>
              <ul className="list">
                {answered.map((q) => (
                  <li key={q._id} className="muted">
                    {q.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section>
          <VisualPanel
            sessionId={session._id}
            token={token}
            chosenId={chosenPreview}
            onChoose={setChosenPreview}
          />
        </section>
      </div>
    </main>
  );
}

function SuggestionCard({
  suggestion,
  onOpenPreview,
}: {
  suggestion: Suggestion;
  onOpenPreview: (previewId: string) => void;
}) {
  return (
    <div className="suggestion">
      <p className="suggestion-head muted">
        Private copilot suggestion
        {suggestion.cached && <span className="pill cached">cached</span>}
      </p>
      <p>{suggestion.explanation}</p>
      <p>
        <strong>Try:</strong> {suggestion.teachingAction}
      </p>
      <p className="sources">
        {suggestion.sourceIds.map((id) => (
          <span key={id} className="chip" title={EXCERPTS[id]}>
            {id}
          </span>
        ))}
      </p>
      {suggestion.previewId ? (
        <button
          className="secondary"
          onClick={() => onOpenPreview(suggestion.previewId!)}
        >
          Show verified highlight in preview
        </button>
      ) : suggestion.molecule ? (
        <p className="error">
          Highlight not verified{suggestion.note ? `: ${suggestion.note}` : ""}
        </p>
      ) : (
        <p className="muted">No highlight proposed for this question.</p>
      )}
      {suggestion.cached && suggestion.note && !suggestion.previewId && !suggestion.molecule && (
        <p className="muted">{suggestion.note}</p>
      )}
    </div>
  );
}
