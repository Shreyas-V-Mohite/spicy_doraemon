import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { errorMessage, getCourseToken } from "../lib/identity";
import AppHeader from "../ui/AppHeader";
import Icon from "../ui/Icon";
import StatusPage from "../ui/StatusPage";
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

  if (course === undefined && token) return <StatusPage title="Loading course..." />;
  if (!course || !token) {
    return (
      <StatusPage
        title="No access to this course"
        text="This browser hasn't been signed in to this course. Sign in with your instructor passcode to open it."
        action={{ to: "/professor", label: "Instructor sign-in" }}
      />
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

  const noLessons = lessons !== undefined && lessons.length === 0;

  return (
    <>
      <AppHeader />
      <main className="container">
        <Link to="/professor" className="back-link">
          <Icon name="arrow-left" />
          All courses
        </Link>
        <div className="page-head">
          <div>
            <span className="eyebrow">Course</span>
            <h1 style={{ marginTop: 6 }}>{course.name}</h1>
          </div>
        </div>

        <section className="card start-card">
          <div className="start-text">
            <h2>Start a live session</h2>
            <p className="muted small">
              Students join with a code or QR code. You'll get the class screen,
              question queue and transcript.
            </p>
          </div>
          <form onSubmit={startSession}>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Today's topic, e.g. Carboxylic acids"
              aria-label="Session topic"
            />
            <button type="submit" disabled={busy || !topic.trim()}>
              Start session
              <Icon name="arrow-right" />
            </button>
          </form>
        </section>
        {noLessons && (
          <p className="notice warn" style={{ marginBottom: 20 }}>
            Add at least one lesson first. Students' questions are answered only from your
            lessons and lecture transcripts.
          </p>
        )}
        {!editing && error && (
          <p className="error" style={{ marginBottom: 16 }}>
            {error}
          </p>
        )}

        <div className="grid-2">
          <section className="card">
            <div className="card-head">
              <div className="title">
                <Icon name="book" />
                <h2>Lessons</h2>
                {lessons && lessons.length > 0 && (
                  <span className="tab-count">{lessons.length}</span>
                )}
              </div>
              {editing === null && (
                <button className="sm" onClick={() => setEditing({ kind: "new" })}>
                  <Icon name="plus" />
                  Add lesson
                </button>
              )}
            </div>

            {editing?.kind === "new" && (
              <div className="card-body" style={{ borderBottom: "1px solid var(--line)" }}>
                <LessonForm
                  heading="New lesson"
                  submitLabel="Save lesson"
                  busy={busy}
                  error={error}
                  onCancel={() => setEditing(null)}
                  onSubmit={(title, text) =>
                    run(() => store.createLesson({ courseId, token, title, text }))
                  }
                />
              </div>
            )}
            {editing?.kind === "edit" && (
              <div className="card-body" style={{ borderBottom: "1px solid var(--line)" }}>
                {editText === undefined ? (
                  <p className="muted">Loading lesson...</p>
                ) : (
                  <LessonForm
                    key={editing.lessonId}
                    heading="Edit lesson"
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
                )}
              </div>
            )}

            {lessons === undefined && <p className="muted card-body">Loading...</p>}
            {noLessons && !editing && (
              <div className="empty">
                <div className="empty-icon">
                  <Icon name="book" size={20} />
                </div>
                <strong>No lessons yet</strong>
                <span>Upload a .md or .txt file, or paste your lecture notes.</span>
              </div>
            )}
            <ul className="rows">
              {lessons?.map((l) => (
                <li key={l._id}>
                  <div className="row-main">
                    <div className="row-title">{l.title}</div>
                    <div className="row-meta">
                      {l.wordCount.toLocaleString()} words, {l.chunkCount} passages
                    </div>
                  </div>
                  {l.status === "saving" ? (
                    <span className="badge accent">Processing</span>
                  ) : (
                    <span className="badge ok">Ready</span>
                  )}
                  <button
                    className="ghost icon-only"
                    title="Edit lesson"
                    aria-label={`Edit ${l.title}`}
                    disabled={busy}
                    onClick={() => setEditing({ kind: "edit", lessonId: l._id })}
                  >
                    <Icon name="pencil" />
                  </button>
                  <button
                    className="ghost danger icon-only"
                    title="Delete lesson"
                    aria-label={`Delete ${l.title}`}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete "${l.title}"?`)) {
                        void run(() =>
                          store.deleteLesson({ courseId, token, lessonId: l._id }),
                        );
                      }
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="title">
                <Icon name="monitor" />
                <h2>Past sessions</h2>
              </div>
            </div>
            {sessions && sessions.length === 0 && (
              <div className="empty">
                <div className="empty-icon">
                  <Icon name="monitor" size={20} />
                </div>
                <strong>No sessions yet</strong>
                <span>Sessions you run will appear here, so you can reopen them.</span>
              </div>
            )}
            <ul className="rows">
              {sessions?.map((s) => (
                <li key={s._id} className="clickable">
                  <Link to={`/professor/${s.code}`} className="row-link">
                    <div className="row-main">
                      <div className="row-title">{s.topic}</div>
                      <div className="row-meta">
                        {new Date(s._creationTime).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                    </div>
                    <span className="code-badge">{s.code}</span>
                    <Icon name="chevron-right" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
