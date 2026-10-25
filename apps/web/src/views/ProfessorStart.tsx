import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { errorMessage, saveCourseToken } from "../lib/identity";

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
      <main className="page narrow">
        <h1>Professor sign-in</h1>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            setPasscode(entered);
          }}
        >
          <label>
            Professor passcode
            <input
              type="password"
              value={entered}
              onChange={(e) => setEntered(e.target.value)}
              autoFocus
            />
          </label>
          {courses === null && <p className="error">Wrong passcode</p>}
          <button type="submit" disabled={!entered}>
            Continue
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="page narrow">
      <h1>Your courses</h1>
      {courses === undefined && <p className="muted">Loading…</p>}
      {courses && courses.length === 0 && (
        <p className="muted">No courses yet. Create your first one below.</p>
      )}
      <ul className="list">
        {courses?.map((c) => (
          <li key={c._id} className="row">
            <span style={{ flex: 1 }}>{c.name}</span>
            <button disabled={busy} onClick={() => open(c._id)}>
              Open
            </button>
          </li>
        ))}
      </ul>

      <h2>New course</h2>
      <form onSubmit={createCourse} className="stack">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Organic Chemistry 101"
          aria-label="Course name"
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || !name.trim()}>
          Create course
        </button>
      </form>
    </main>
  );
}
