import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function Home() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();

  return (
    <main className="page narrow">
      <h1>Join a class</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) navigate(`/s/${code.trim().toUpperCase()}`);
        }}
      >
        <input
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="CODE"
          maxLength={5}
          autoFocus
          autoCapitalize="characters"
        />
        <button type="submit" disabled={code.trim().length === 0}>
          Join
        </button>
      </form>
      <p className="muted">
        Teaching? <Link to="/professor">Start a session</Link>
      </p>
    </main>
  );
}
