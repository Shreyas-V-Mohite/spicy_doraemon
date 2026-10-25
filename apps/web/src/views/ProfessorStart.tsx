import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { errorMessage, saveProfessorToken } from "../lib/identity";

export default function ProfessorStart() {
  const store = useStore();
  const navigate = useNavigate();
  const [passcode, setPasscode] = useState("");
  const [topic, setTopic] = useState("Functional groups");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = crypto.randomUUID();
      const { code } = await store.createSession({ passcode, token, topic });
      saveProfessorToken(code, token);
      navigate(`/professor/${code}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>Start a session</h1>
      <form onSubmit={start} className="stack">
        <label>
          Topic
          <input value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label>
          Professor passcode
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || !passcode || !topic.trim()}>
          Create session
        </button>
      </form>
    </main>
  );
}
