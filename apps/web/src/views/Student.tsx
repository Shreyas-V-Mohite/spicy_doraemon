import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import {
  errorMessage,
  getMyVote,
  getStudentId,
  saveMyVote,
} from "../lib/identity";
import type { FeedbackValue } from "../types";

export default function Student() {
  const { code = "" } = useParams();
  const store = useStore();
  const studentId = getStudentId();
  const session = store.useSession(code);
  const mine = store.useMyQuestions(session?._id, studentId);
  const [text, setText] = useState("");
  const [vote, setVote] = useState(getMyVote(code));
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
    setVote(value);
    saveMyVote(code, value);
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
                {q.text}{" "}
                {q.status === "answered" && (
                  <span className="pill understood">answered</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
