import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { getCourseToken } from "../lib/identity";
import type { Question, QueueCard } from "../types";
import Stage from "./Stage";
import VisualPanel from "./VisualPanel";

const FLAGGED = new Set(["not_covered", "failed"]);

export default function Professor() {
  const { code = "" } = useParams();
  const store = useStore();
  const session = store.useSession(code);
  const token = session?.courseId ? getCourseToken(session.courseId) : null;
  const queue = store.useProfessorQueue(session?._id, token);
  const counts = store.useFeedbackCounts(session?._id);
  const visual = store.useCurrentVisual(session?._id);
  const [chosenPreview, setChosenPreview] = useState<string | null>(null);
  const [present, setPresent] = useState(false);

  // Escape leaves Present mode.
  useEffect(() => {
    if (!present) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPresent(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [present]);

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

  // The server already puts cards that need the professor first.
  const open = queue?.filter((c) => c.open) ?? [];
  const done = queue?.filter((c) => !c.open) ?? [];

  async function markDone(card: QueueCard) {
    if (!session || !token) return;
    if (card.groupId) {
      await store.markGroupAnswered({
        sessionId: session._id,
        token,
        groupId: card.groupId,
      });
    } else {
      await store.markAnswered({
        sessionId: session._id,
        token,
        questionId: card.members[0]._id,
      });
    }
  }

  return (
    <main className={present ? "page present-mode" : "page"}>
      <header className="bar">
        <div>
          <h1>{session.topic}</h1>
          {!present && session.courseId && (
            <p className="muted">
              <Link to={`/professor/course/${session.courseId}`}>← Course</Link>
            </p>
          )}
        </div>
        <div className="counts">
          {!present && (
            <button
              className="secondary"
              onClick={() => store.resetFeedback({ sessionId: session._id, token })}
            >
              Reset votes
            </button>
          )}
          <button
            className={present ? "secondary" : undefined}
            onClick={() => setPresent(!present)}
            title="Hides the private panels so this page can be screen-shared"
          >
            {present ? "Exit present mode" : "Present mode"}
          </button>
        </div>
      </header>

      <div className={present ? "present-grid" : "columns"}>
        <section>
          <Stage session={session} counts={counts} visual={visual} present={present} />
        </section>

        {!present && (
          <section>
            <h2>Question queue ({open.length})</h2>
            {queue === undefined && <p className="muted">Loading…</p>}
            {queue && open.length === 0 && (
              <p className="muted">No open questions yet.</p>
            )}
            <ul className="list">
              {open.map((card) => (
                <li key={card.key} className={card.flagged ? "flagged" : undefined}>
                  <QuestionCard
                    card={card}
                    onDone={() => markDone(card)}
                    onSplit={(questionId) =>
                      store.splitFromGroup({
                        sessionId: session._id,
                        token,
                        questionId,
                      })
                    }
                  />
                </li>
              ))}
            </ul>
            {done.length > 0 && (
              <details>
                <summary>Answered ({done.length})</summary>
                <ul className="list">
                  {done.map((card) => (
                    <li key={card.key} className="muted">
                      {card.label ?? card.members[0].text}
                      {card.studentCount > 1 && ` · ${card.studentCount} students`}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <VisualPanel
              sessionId={session._id}
              token={token}
              chosenId={chosenPreview}
              onChoose={setChosenPreview}
            />
          </section>
        )}
      </div>
    </main>
  );
}

function QuestionCard({
  card,
  onDone,
  onSplit,
}: {
  card: QueueCard;
  onDone: () => void;
  onSplit: (questionId: string) => void;
}) {
  const grouped = card.members.length > 1;
  const openMembers = card.members.filter((m) => m.status === "open");
  // Show the answer that needs attention, else the original (oldest) one.
  const rep =
    openMembers.find((m) => FLAGGED.has(m.answerStatus ?? "")) ??
    card.members[card.members.length - 1];
  return (
    <>
      <p>
        <strong>{card.label ?? rep.text}</strong>{" "}
        {card.studentCount > 1 && (
          <span className="pill confused">{card.studentCount} students</span>
        )}
      </p>
      <AnswerLine question={rep} />
      {grouped && (
        <details>
          <summary className="muted">All {card.members.length} questions</summary>
          <ul className="list">
            {card.members.map((m) => (
              <li key={m._id}>
                <p>{m.text}</p>
                <button
                  className="secondary"
                  onClick={() => onSplit(m._id)}
                  title="This question is not the same as the others"
                >
                  Split out
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="row">
        <button className="secondary" onClick={onDone}>
          {grouped ? "Mark all answered" : "Mark answered"}
        </button>
      </div>
    </>
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
