import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { errorMessage, saveCourseToken } from "../lib/identity";
import AppHeader from "../ui/AppHeader";
import Icon from "../ui/Icon";

// Passcode in, then pick a course or create one. The passcode lives only in
// this component's state; what the browser keeps is a per-course token.
export default function ProfessorStart() {
  const store = useStore();
  const navigate = useNavigate();
  const [entered, setEntered] = useState("");
  const [passcode, setPasscode] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const courses = store.useCourses(passcode);

  async function open(courseId: string) {
    if (!passcode) return;
    setBusy(true);
    setError(null);
    try {
      const token = crypto.randomUUID();
      await store.claimCourse({ passcode, courseId, token });
      saveCourseToken(courseId, token);
      navigate(`/professor/course/${courseId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function createCourse(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode) return;
    setBusy(true);
    setError(null);
    try {
      const token = crypto.randomUUID();
      const courseId = await store.createCourse({ passcode, token, name });
      saveCourseToken(courseId, token);
      navigate(`/professor/course/${courseId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (passcode === null || courses === null) {
    return (
      <>
        <AppHeader>
          <Link to="/" className="btn secondary sm">
            Join as student
          </Link>
        </AppHeader>
        <main className="auth-wrap">
          <div className="card auth-card">
            <div className="auth-icon">
              <Icon name="lock" size={20} />
            </div>
            <h1>Instructor sign-in</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              Enter your passcode to manage courses and run live sessions.
            </p>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                setPasscode(entered);
              }}
            >
              <label className="field">
                Passcode
                <input
                  type="password"
                  value={entered}
                  onChange={(e) => setEntered(e.target.value)}
                  autoFocus
                  autoComplete="current-password"
                />
              </label>
              {courses === null && (
                <p className="error">That passcode isn't right. Try again.</p>
              )}
              <button type="submit" className="lg block" disabled={!entered}>
                Continue
              </button>
            </form>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader>
        <button className="ghost sm" onClick={() => setPasscode(null)}>
          Sign out
        </button>
      </AppHeader>
      <main className="container">
        <div className="page-head">
          <div>
            <span className="eyebrow">Instructor</span>
            <h1 style={{ marginTop: 6 }}>Your courses</h1>
            <p className="muted">
              Open a course to manage its lessons or start a live session.
            </p>
          </div>
        </div>

        {courses === undefined && <p className="muted">Loading courses...</p>}
        {error && (
          <p className="error" style={{ marginBottom: 16 }}>
            {error}
          </p>
        )}

        <div className="course-grid">
          {courses?.map((c) => (
            <button
              key={c._id}
              className="course-tile"
              disabled={busy}
              onClick={() => open(c._id)}
            >
              <span className="tile-icon">
                <Icon name="book" size={18} />
              </span>
              <span className="tile-name">{c.name}</span>
              <span className="tile-foot">
                Open course
                <Icon name="arrow-right" />
              </span>
            </button>
          ))}

          <div className="course-tile new">
            <span className="tile-icon">
              <Icon name="plus" size={18} />
            </span>
            <span className="tile-name">New course</span>
            <form onSubmit={createCourse}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Organic Chemistry 101"
                aria-label="Course name"
              />
              <button type="submit" disabled={busy || !name.trim()}>
                Create course
              </button>
            </form>
          </div>
        </div>
      </main>
    </>
  );
}
