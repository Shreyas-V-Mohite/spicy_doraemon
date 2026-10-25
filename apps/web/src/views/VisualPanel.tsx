import { useState } from "react";
import { useStore } from "../store/sessionStore";
import { errorMessage } from "../lib/identity";
import { DEMO_MOLECULES, GROUPS } from "../lesson";
import MoleculeView from "../viewer/MoleculeView";

interface Props {
  sessionId: string;
  token: string;
}

// Private preview, then explicit publish. Students only ever see what is
// published; previews live in a professor-only table.
export default function VisualPanel({ sessionId, token }: Props) {
  const store = useStore();
  const previews = store.useProfessorPreviews(sessionId, token);
  const published = store.useCurrentVisual(sessionId);
  const [molecule, setMolecule] = useState(DEMO_MOLECULES[1]);
  const [groupId, setGroupId] = useState("carboxylic_acid");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview =
    previews?.find((p) => p._id === chosenId) ?? previews?.[0] ?? null;

  async function build(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setChosenId(
        await store.buildPreview({ sessionId, token, query: molecule, groupId }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <h2>Molecule preview</h2>
      <form onSubmit={build} className="row">
        <input
          list="demo-molecules"
          value={molecule}
          onChange={(e) => setMolecule(e.target.value)}
          aria-label="Molecule"
        />
        <datalist id="demo-molecules">
          {DEMO_MOLECULES.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          aria-label="Functional group"
        >
          {GROUPS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !molecule.trim()}>
          {busy ? "Verifying…" : "Build preview"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      {preview ? (
        <>
          <p className="muted">
            Verified: {preview.label} in {preview.query} (private)
          </p>
          <MoleculeView sdf={preview.sdf} highlight={preview.indices} />
          <div className="row">
            <button
              onClick={() =>
                run(() => store.publish({ sessionId, token, previewId: preview._id }))
              }
            >
              Publish to students
            </button>
          </div>
        </>
      ) : (
        <p className="muted">
          No preview yet. Only highlights verified by RDKit can be built.
        </p>
      )}

      {published && (
        <p className="published">
          Live: {published.label} in {published.query}{" "}
          <button
            className="secondary"
            onClick={() => run(() => store.unpublish({ sessionId, token }))}
          >
            Unpublish
          </button>
        </p>
      )}
    </div>
  );
}
