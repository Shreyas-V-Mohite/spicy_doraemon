import { useState } from "react";
import type { TranscriberStatus } from "../transcribe/Transcriber";
import type { TranscriptLine } from "../types";
import Icon from "../ui/Icon";

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
    <div className="transcript">
      {!supported ? (
        <p className="notice warn">
          This browser can't transcribe speech. Open this page in Chrome to use it.
        </p>
      ) : (
        <div className="row">
          {listening ? (
            <button className="secondary" onClick={onPause}>
              Pause
            </button>
          ) : (
            <button onClick={onStart}>
              <Icon name="mic" />
              Start transcribing
            </button>
          )}
          <span className={listening ? "live-dot on" : "live-dot"}>
            {listening ? "Listening" : status === "error" ? "Problem" : "Off"}
          </span>
        </div>
      )}
      <p className="muted small">
        Students can ask about what you say. Answers may quote this text, so fix or delete
        anything the microphone got wrong. Only text is kept, never audio.
      </p>
      {detail && <p className={listening ? "muted small" : "error"}>{detail}</p>}
      {error && <p className="error">{error}</p>}

      <ul className="transcript-lines">
        {lines?.map((line) => (
          <li key={line._id}>
            {editing === line._id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void guard(async () => {
                    await onEdit(line._id, draft);
                    setEditing(null);
                  });
                }}
              >
                <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                <button type="submit" className="sm" disabled={!draft.trim()}>
                  Save
                </button>
                <button type="button" className="ghost sm" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="line-text">{line.text}</span>
                <span className="line-actions">
                  <button
                    className="ghost icon-only"
                    title="Edit line"
                    aria-label="Edit line"
                    onClick={() => {
                      setEditing(line._id);
                      setDraft(line.text);
                    }}
                  >
                    <Icon name="pencil" size={14} />
                  </button>
                  <button
                    className="ghost danger icon-only"
                    title="Delete line"
                    aria-label="Delete line"
                    onClick={() => void guard(() => onDelete(line._id))}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {interim && <p className="interim">{interim}...</p>}
      {lines && lines.length === 0 && !interim && (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="mic" size={20} />
          </div>
          <strong>Nothing transcribed yet</strong>
          <span>Start transcribing and your lecture appears here line by line.</span>
        </div>
      )}
      {lines && lines.length > 0 && (
        <button
          className="ghost danger sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            if (window.confirm("Delete this session's whole transcript?")) {
              void guard(onClear);
            }
          }}
        >
          <Icon name="trash" size={14} />
          Delete whole transcript
        </button>
      )}
    </div>
  );
}
