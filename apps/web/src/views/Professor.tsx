import { Link, useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { getProfessorToken } from "../lib/identity";

export default function Professor() {
  const { code = "" } = useParams();
  const store = useStore();
  const session = store.useSession(code);
  const token = getProfessorToken(code);
  const questions = store.useProfessorQuestions(session?._id, token);
  const counts = store.useFeedbackCounts(session?._id);

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
                  <button disabled title="Added with the Claude integration">
                    Ask copilot
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
          <h2>Copilot and molecule preview</h2>
          <p className="muted">
            Private suggestions and the molecular preview will appear here.
          </p>
        </section>
      </div>
    </main>
  );
}
