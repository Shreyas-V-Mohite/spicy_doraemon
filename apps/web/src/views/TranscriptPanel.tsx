import { useState } from "react";
import type { TranscriberStatus } from "../transcribe/Transcriber";
import type { TranscriptLine } from "../types";

interface Props {
  status: TranscriberStatus;
  detail: string | undefined;
  interim: string;
  supported: boolean;
  lines: TranscriptLine[] | undefined;
  onStart: () => void;
  onPause: () => void;
  onEdit: (lineId: string, text: string) => Promise<void>;
  onDelete: (lineId: string) => Promise<void>;
  onClear: () => Promise<void>;
}

// The professor's view of what is being transcribed. Answers can quote this
// text, so wrong lines should be fixed or deleted here.
export default function TranscriptPanel({
  status,
  detail,
  interim,
  supported,
  lines,
  onStart,
  onPause,
  onEdit,
  onDelete,
  onClear,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listening = status === "listening";

  async function guard(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch {
      setError("That change didn't save. Try again.");
    }
  }

  return (
    <div className="stack">
      <h2>Lecture transcript</h2>
      <p className="muted">
        Students can ask about what you say. Answers may quote this text, so fix
        or delete anything the microphone got wrong.
      </p>
      {!supported ? (
        <p className="error">This browser can't transcribe. Use Chrome.</p>
      ) : (
        <div className="row">
          {listening ? (
            <button className="secondary" onClick={onPause}>
              Pause transcribing
            </button>
          ) : (
            <button onClick={onStart}>Start transcribing</button>
          )}
          <span className={listening ? "live-dot on" : "live-dot"}>
            {listening ? "Listening" : status === "error" ? "Problem" : "Off"}
          </span>
        </div>
      )}
      {detail && (
        <p className={status === "listening" ? "muted" : "error"}>{detail}</p>
      )}
      {error && <p className="error">{error}</p>}
      {interim && <p className="muted">{interim}…</p>}

      <ul className="list transcript">
        {lines?.map((line) => (
          <li key={line._id}>
            {editing === line._id ? (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void guard(async () => {
                    await onEdit(line._id, draft);
                    setEditing(null);
                  });
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  style={{ flex: 1 }}
                  autoFocus
                />
                <button type="submit" disabled={!draft.trim()}>
                  Save
                </button>
                <button type="button" className="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span>{line.text}</span>
                <span className="row line-actions">
                  <button
                    className="secondary"
                    onClick={() => {
                      setEditing(line._id);
                      setDraft(line.text);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary"
                    onClick={() => void guard(() => onDelete(line._id))}
                  >
                    Delete
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {lines && lines.length === 0 && (
          <li className="muted">Nothing transcribed yet.</li>
        )}
      </ul>
      {lines && lines.length > 0 && (
        <button
          className="secondary"
          onClick={() => {
            if (window.confirm("Delete this session's whole transcript?")) {
              void guard(onClear);
            }
          }}
        >
          Delete whole transcript
        </button>
      )}
    </div>
  );
}
