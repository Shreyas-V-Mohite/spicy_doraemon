import { useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import MoleculeView from "../viewer/MoleculeView";

export default function Presentation() {
  const { code = "" } = useParams();
  const store = useStore();
  const session = store.useSession(code);
  const counts = store.useFeedbackCounts(session?._id);
  const visual = store.useCurrentVisual(session?._id);

  if (session === undefined) return <main className="present">Loading…</main>;
  if (session === null) {
    return <main className="present">No session with code {code}.</main>;
  }

  const joinUrl = `${window.location.origin}/s/${session.code}`;

  return (
    <main className="present">
      <h1>{session.topic}</h1>
      <p className="join">
        Join at <strong>{joinUrl}</strong> with code{" "}
        <strong className="code">{session.code}</strong>
      </p>
      <div className="stage">
        {visual ? (
          <>
            <p className="caption">
              {visual.label} in {visual.query}
            </p>
            <MoleculeView sdf={visual.sdf} highlight={visual.indices} />
          </>
        ) : (
          <p className="muted">Waiting for the professor to publish a visual.</p>
        )}
      </div>
      <div className="counts big">
        <span className="pill confused">Confused {counts?.confused ?? 0}</span>
        <span className="pill understood">
          Understood {counts?.understood ?? 0}
        </span>
      </div>
    </main>
  );
}
