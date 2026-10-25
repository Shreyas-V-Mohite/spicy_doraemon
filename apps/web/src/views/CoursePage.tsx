import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { errorMessage, getCourseToken } from "../lib/identity";
import LessonForm from "./LessonForm";

type Editing = { kind: "new" } | { kind: "edit"; lessonId: string } | null;

export default function CoursePage() {
  const { courseId = "" } = useParams();
  const store = useStore();
  const navigate = useNavigate();
  const token = getCourseToken(courseId);
  const course = store.useCourse(courseId, token);
  const authorized = course ? courseId : undefined;
  const lessons = store.useLessons(authorized, token);
  const sessions = store.useCourseSessions(authorized, token);

  const [editing, setEditing] = useState<Editing>(null);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editLessonId = editing?.kind === "edit" ? editing.lessonId : null;
  const editText = store.useLessonText(authorized, token, editLessonId);

  if (course === undefined && token) return <main className="page">Loading…</main>;
  if (!course || !token) {
    return (
      <main className="page narrow">
        <p>This browser doesn't have access to that course.</p>
        <Link to="/professor">Sign in</Link>
      </main>
    );
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function startSession(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const { code } = await store.createSession({ courseId, token, topic });
      navigate(`/professor/${code}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <p>
        <Link to="/professor">← Courses</Link>
      </p>
      <h1>{course.name}</h1>

      <div className="columns">
        <section>
          <h2>Lessons</h2>
          <p className="muted">
            Answers come only from these lessons and the lecture transcripts of
            this course.
          </p>
          {lessons && lessons.length === 0 && !editing && (
            <p className="muted">No lessons yet.</p>
          )}
          <ul className="list">
            {lessons?.map((l) => (
              <li key={l._id}>
                <p>
                  <strong>{l.title}</strong>
                  <span className="muted">
                    {" "}
                    · {l.wordCount.toLocaleString()} words · {l.chunkCount} passages
                    {l.status === "saving" && " · saving…"}
                  </span>
                </p>
                <div className="row">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setEditing({ kind: "edit", lessonId: l._id })}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete "${l.title}"?`)) {
                        void run(() =>
                          store.deleteLesson({ courseId, token, lessonId: l._id }),
                        );
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {editing === null && (
            <p>
              <button onClick={() => setEditing({ kind: "new" })}>Add a lesson</button>
            </p>
          )}
          {editing?.kind === "new" && (
            <LessonForm
              submitLabel="Save lesson"
              busy={busy}
              error={error}
              onCancel={() => setEditing(null)}
              onSubmit={(title, text) =>
                run(() => store.createLesson({ courseId, token, title, text }))
              }
            />
          )}
          {editing?.kind === "edit" &&
            (editText === undefined ? (
              <p className="muted">Loading…</p>
            ) : (
              <LessonForm
                key={editing.lessonId}
                initialTitle={editText.title}
                initialText={editText.text}
                submitLabel="Save changes"
                busy={busy}
                error={error}
                onCancel={() => setEditing(null)}
                onSubmit={(title, text) =>
                  run(() =>
                    store.updateLesson({
                      courseId,
                      token,
                      lessonId: editing.lessonId,
                      title,
                      text,
                    }),
                  )
                }
              />
            ))}
        </section>

        <section>
          <h2>Start a session</h2>
          <form onSubmit={startSession} className="row">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Today's topic"
              aria-label="Topic"
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={busy || !topic.trim()}>
              Start
            </button>
          </form>
          {!editing && error && <p className="error">{error}</p>}

          <h2>Past sessions</h2>
          {sessions && sessions.length === 0 && (
            <p className="muted">No sessions yet.</p>
          )}
          <ul className="list">
            {sessions?.map((s) => (
              <li key={s._id}>
                <Link to={`/professor/${s.code}`}>{s.topic}</Link>{" "}
                <span className="muted">
                  · {s.code} · {new Date(s._creationTime).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
