import type { DetectedGroup, MoleculeStyle } from "../types";

export type MoleculeInput = { kind: "name" | "smiles"; value: string };

const EXAMPLES = ["ethanol", "aspirin", "ibuprofen", "caffeine", "acetone"];
const STYLES: { id: MoleculeStyle; label: string }[] = [
  { id: "ball-and-stick", label: "Ball and stick" },
  { id: "stick", label: "Stick" },
  { id: "spacefill", label: "Space-filling" },
];

interface Props {
  input: MoleculeInput;
  onInput: (input: MoleculeInput) => void;
  onLoad: (input: MoleculeInput) => void;
  loading: boolean;
  groups: DetectedGroup[] | null;
  groupId: string | null;
  onGroup: (id: string | null) => void;
  style: MoleculeStyle;
  onStyle: (style: MoleculeStyle) => void;
  // What the class currently sees, versus what is on this stage.
  shareState: "nothing-loaded" | "not-shared" | "shared" | "different";
  sharedCaption: string | null;
  sharing: boolean;
  onShare: () => void;
  onUnshare: () => void;
  error: string | null;
}

// The professor's molecule controls. The chips are the groups RDKit found in
// the loaded molecule, so only real groups can be highlighted.
export default function StageControls({
  input,
  onInput,
  onLoad,
  loading,
  groups,
  groupId,
  onGroup,
  style,
  onStyle,
  shareState,
  sharedCaption,
  sharing,
  onShare,
  onUnshare,
  error,
}: Props) {
  return (
    <div className="stack stage-controls">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          onLoad(input);
        }}
      >
        <select
          value={input.kind}
          onChange={(e) =>
            onInput({ ...input, kind: e.target.value as "name" | "smiles" })
          }
          aria-label="Input type"
        >
          <option value="name">Name</option>
          <option value="smiles">SMILES</option>
        </select>
        <input
          value={input.value}
          onChange={(e) => onInput({ ...input, value: e.target.value })}
          placeholder={input.kind === "name" ? "e.g. aspirin" : "e.g. CC(=O)O"}
          aria-label="Molecule"
          style={{ flex: 1, minWidth: 140 }}
        />
        <button type="submit" disabled={loading || !input.value.trim()}>
          {loading ? "Loading…" : "Load"}
        </button>
      </form>
      <p className="row muted">
        Try:
        {EXAMPLES.map((name) => (
          <button
            key={name}
            type="button"
            className="chip-button"
            disabled={loading}
            onClick={() => onLoad({ kind: "name", value: name })}
          >
            {name}
          </button>
        ))}
      </p>

      {groups !== null && (
        <div className="row">
          {groups.length === 0 ? (
            <span className="muted">No supported functional groups found.</span>
          ) : (
            <>
              <button
                type="button"
                className={groupId === null ? "chip-button active" : "chip-button"}
                onClick={() => onGroup(null)}
              >
                No highlight
              </button>
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={groupId === g.id ? "chip-button active" : "chip-button"}
                  onClick={() => onGroup(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <div className="row">
        <select
          value={style}
          onChange={(e) => onStyle(e.target.value as MoleculeStyle)}
          aria-label="Display style"
        >
          {STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          onClick={onShare}
          disabled={sharing || shareState === "nothing-loaded" || shareState === "shared"}
        >
          {sharing ? "Sharing…" : shareState === "shared" ? "Shared with class" : "Share molecule"}
        </button>
        {sharedCaption && (
          <button className="secondary" onClick={onUnshare} disabled={sharing}>
            Stop sharing
          </button>
        )}
      </div>
      {sharedCaption && shareState === "different" && (
        <p className="muted">Students are seeing: {sharedCaption}</p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
