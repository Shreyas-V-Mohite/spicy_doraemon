import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { getCourseToken } from "../lib/identity";
import type { Question } from "../types";
import VisualPanel from "./VisualPanel";

const FLAGGED = new Set(["not_covered", "failed"]);

export default function Professor() {
  const { code = "" } = useParams();
  const store = useStore();
  const session = store.useSession(code);
  const token = session?.courseId ? getCourseToken(session.courseId) : null;
  const questions = store.useProfessorQuestions(session?._id, token);
  const counts = store.useFeedbackCounts(session?._id);
  const [chosenPreview, setChosenPreview] = useState<string | null>(null);

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
        <Link to="/professor">Sign in as professor</Link>
      </main>
    );
  }

  // Questions the lesson couldn't answer come first: those need the professor.
  const open = (questions?.filter((q) => q.status === "open") ?? []).sort(
    (a, b) =>
      Number(FLAGGED.has(b.answerStatus ?? "")) -
      Number(FLAGGED.has(a.answerStatus ?? "")),
  );
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
          <button
            className="secondary"
            onClick={() =>
              store.resetFeedback({ sessionId: session._id, token })
            }
          >
            Reset
          </button>
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
                <AnswerLine question={q} />
                <div className="row">
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
              </li>
            ))}
          </ul>
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

function AnswerLine({ question }: { question: Question }) {
  const status = question.answerStatus;
  if (status === null || status === "pending") {
    return <p className="muted">Looking in the lesson…</p>;
  }
  if (FLAGGED.has(status)) {
    return (
      <p className="error">
        {status === "failed" ? "Couldn't answer" : "Not covered by your lesson"}
        {question.answerNote ? ` (${question.answerNote})` : ""}. The student was
        told you've been notified.
      </p>
    );
  }
  return (
    <details>
      <summary className="muted">
        {status === "fallback" ? "Closest passage shown" : "Answered from the lesson"}
      </summary>
      <p>{question.answerText}</p>
    </details>
  );
}
