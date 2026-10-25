import type { TrackingPhase } from "@spicy/hand-gesture";
import type { DetectedGroup, MoleculeStyle } from "../types";
import Icon from "../ui/Icon";

export type MoleculeInput = { kind: "name" | "smiles"; value: string };
export type ShareState = "nothing-loaded" | "not-shared" | "shared" | "different";

const GESTURE_STATUS: Record<TrackingPhase, string> = {
  idle: "",
  "loading-models": "Loading hand tracking...",
  "requesting-camera": "Allow the camera when your browser asks.",
  running: "Open and close your hand to resize, hold it still and turn it to rotate, point to move.",
  error: "",
};

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
  error: string | null;
  // Shown only where the gestures toggle belongs with these controls.
  gestures?: {
    on: boolean;
    phase: TrackingPhase;
    error: string | undefined;
    onToggle: () => void;
  };
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
  error,
  gestures,
}: Props) {
  return (
    <div className="mol-controls">
      <form
        className="mol-search"
        onSubmit={(e) => {
          e.preventDefault();
          onLoad(input);
        }}
      >
        <div className="segmented" role="group" aria-label="Search by">
          {(["name", "smiles"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={input.kind === kind ? "active" : undefined}
              onClick={() => onInput({ ...input, kind })}
            >
              {kind === "name" ? "Name" : "SMILES"}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Icon name="search" />
          <input
            value={input.value}
            onChange={(e) => onInput({ ...input, value: e.target.value })}
            placeholder={input.kind === "name" ? "Search a molecule, e.g. aspirin" : "Enter SMILES, e.g. CC(=O)O"}
            aria-label="Molecule"
            className={input.kind === "smiles" ? "mono" : undefined}
            spellCheck={false}
          />
        </div>
        <button type="submit" disabled={loading || !input.value.trim()}>
          {loading ? "Loading..." : "Load"}
        </button>
      </form>

      {groups === null ? (
        <div className="row">
          <span className="control-label">Examples</span>
          {EXAMPLES.map((name) => (
            <button
              key={name}
              type="button"
              className="chip"
              disabled={loading}
              onClick={() => onLoad({ kind: "name", value: name })}
            >
              {name}
            </button>
          ))}
        </div>
      ) : (
        <div className="row">
          <span className="control-label">Highlight</span>
          {groups.length === 0 ? (
            <span className="muted small">No supported functional groups in this molecule.</span>
          ) : (
            <>
              <button
                type="button"
                className={groupId === null ? "chip active" : "chip"}
                onClick={() => onGroup(null)}
              >
                None
              </button>
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={groupId === g.id ? "chip active" : "chip"}
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
        <span className="control-label">Display</span>
        <div className="segmented" role="group" aria-label="Display style">
          {STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={style === s.id ? "active" : undefined}
              onClick={() => onStyle(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {gestures && (
          <>
            <span className="spacer" />
            <button
              type="button"
              className={gestures.on ? "sm" : "secondary sm"}
              onClick={gestures.onToggle}
              title="Control the molecule with your hand, in front of your camera"
            >
              <Icon name="video" />
              {gestures.on ? "Hand gestures on" : "Hand gestures"}
            </button>
          </>
        )}
      </div>
      {gestures?.on && GESTURE_STATUS[gestures.phase] && (
        <p className="notice accent">{GESTURE_STATUS[gestures.phase]}</p>
      )}
      {gestures?.error && <p className="error">{gestures.error}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// Below the viewer: put what is on the professor's stage on every student's screen.
export function ShareBar({
  shareState,
  sharedCaption,
  sharing,
  onShare,
  onUnshare,
}: {
  shareState: ShareState;
  sharedCaption: string | null;
  sharing: boolean;
  onShare: () => void;
  onUnshare: () => void;
}) {
  if (shareState === "nothing-loaded" && !sharedCaption) return null;
  return (
    <div className="share-row">
      {shareState !== "nothing-loaded" && (
        <button onClick={onShare} disabled={sharing || shareState === "shared"}>
          {shareState === "shared" ? <Icon name="check" /> : <Icon name="send" />}
          {sharing
            ? "Sharing..."
            : shareState === "shared"
              ? "On students' screens"
              : shareState === "different"
                ? "Update students' screens"
                : "Share with class"}
        </button>
      )}
      {sharedCaption && (
        <button className="secondary" onClick={onUnshare} disabled={sharing}>
          Stop sharing
        </button>
      )}
      {sharedCaption && shareState !== "shared" && (
        <span className="muted small">
          Students now see: <strong style={{ textTransform: "capitalize" }}>{sharedCaption}</strong>
        </span>
      )}
    </div>
  );
}
