import { Link } from "react-router-dom";
import AppHeader from "./AppHeader";

// A full page for "loading", "not found" and "no access" states.
export default function StatusPage({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: { to: string; label: string };
}) {
  return (
    <>
      <AppHeader />
      <main className="auth-wrap">
        <div className="card auth-card stack">
          <h1>{title}</h1>
          {text && <p className="muted">{text}</p>}
          {action && (
            <Link to={action.to} className="btn" style={{ alignSelf: "flex-start" }}>
              {action.label}
            </Link>
          )}
        </div>
      </main>
    </>
  );
}
