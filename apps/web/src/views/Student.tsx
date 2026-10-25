import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { errorMessage, getStudentId } from "../lib/identity";
import type { FeedbackValue, MyQuestion } from "../types";
import MoleculeView from "../viewer/MoleculeView";

export default function Student() {
  const { code = "" } = useParams();
  const store = useStore();
  const studentId = getStudentId();
  const session = store.useSession(code);
  const mine = store.useMyQuestions(session?._id, studentId);
  const visual = store.useCurrentVisual(session?._id);
  const [text, setText] = useState("");
  const vote = store.useMyVote(session?._id, studentId);
  const [error, setError] = useState<string | null>(null);

  if (session === undefined) return <main className="page">Loading…</main>;
  if (session === null) {
    return (
      <main className="page narrow">
        <p>No session with code {code}.</p>
        <Link to="/">Try another code</Link>
      </main>
    );
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setError(null);
    try {
      await store.ask({ sessionId: session._id, studentId, text });
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function sendVote(value: FeedbackValue) {
    if (!session) return;
    try {
      await store.setFeedback({ sessionId: session._id, studentId, value });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <main className="page narrow">
      <h1>{session.topic}</h1>
      <p className="muted">Session {session.code}</p>

      {visual && (
        <>
          <p className="muted">
            {visual.label} in {visual.query}
          </p>
          <MoleculeView sdf={visual.sdf} highlight={visual.indices} />
        </>
      )}

      <div className="row votes">
        <button
          className={`confused ${vote === "confused" ? "active" : ""}`}
          onClick={() => sendVote("confused")}
        >
          Confused
        </button>
        <button
          className={`understood ${vote === "understood" ? "active" : ""}`}
          onClick={() => sendVote("understood")}
        >
          Understood
        </button>
      </div>

      <form onSubmit={ask} className="stack">
        <label>
          Ask a question
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={text.trim().length === 0}>
          Send
        </button>
      </form>

      {mine && mine.length > 0 && (
        <>
          <h2>Your questions</h2>
          <ul className="list">
            {mine.map((q) => (
              <li key={q._id}>
                <p>
                  <strong>{q.text}</strong>
                </p>
                {q.similarCount > 0 && (
                  <p className="muted">
                    {q.similarCount === 1
                      ? "1 classmate asked something similar"
                      : `${q.similarCount} classmates asked something similar`}
                  </p>
                )}
                <AnswerCard answer={q.answer} />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function AnswerCard({ answer }: { answer: MyQuestion["answer"] }) {
  if (answer === null || answer.status === "pending") {
    return <p className="muted">Looking in your lesson…</p>;
  }
  if (answer.status === "not_covered") {
    return (
      <p className="muted">
        Your lesson doesn't cover this. Your professor has been notified.
      </p>
    );
  }
  if (answer.status === "failed") {
    return (
      <p className="muted">
        Couldn't answer right now. Your professor has been notified.
      </p>
    );
  }
  return (
    <div>
      {answer.text && <p>{answer.text}</p>}
      {answer.quotes.map((quote, i) => (
        <blockquote key={i} className="quote">
          {quote.text}
          <cite>From {quote.label}</cite>
        </blockquote>
      ))}
    </div>
  );
}
