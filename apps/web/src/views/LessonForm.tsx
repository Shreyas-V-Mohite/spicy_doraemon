import { useMemo, useState } from "react";
import {
  chunkLesson,
  countWords,
  MAX_LESSON_WORDS,
} from "../../../../convex/lib/chunk";
import Icon from "../ui/Icon";

interface Props {
  heading: string;
  initialTitle?: string;
  initialText?: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (title: string, text: string) => void;
  onCancel: () => void;
}

// Paste or upload a .md/.txt lesson and see the passages it will be split into.
export default function LessonForm({
  heading,
  initialTitle = "",
  initialText = "",
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);
  const [fileName, setFileName] = useState<string | null>(null);
  const words = countWords(text);
  const chunks = useMemo(() => chunkLesson(text), [text]);
  const tooLong = words > MAX_LESSON_WORDS;

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setText(await file.text());
    setFileName(file.name);
    if (!title.trim()) setTitle(file.name.replace(/\.(md|txt)$/i, ""));
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(title, text);
      }}
    >
      <h3>{heading}</h3>
      <label className="field">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Functional groups"
        />
      </label>
      <label className="drop-zone">
        <span className="dz-icon">
          <Icon name="upload" />
        </span>
        <span>
          {fileName ?? "Upload a .md or .txt file"}
          <span className="muted small" style={{ display: "block", fontWeight: 400 }}>
            {fileName ? "Click to choose a different file" : "Or paste the text below"}
          </span>
        </span>
        <input
          type="file"
          accept=".md,.txt,text/markdown,text/plain"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
      </label>
      <label className="field">
        Lesson text
        <textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your lecture notes. Headings (# Title) help split them into passages."
        />
      </label>
      <div className={tooLong ? "meter over" : "meter"}>
        <span>
          {words.toLocaleString()} / {MAX_LESSON_WORDS.toLocaleString()} words
        </span>
        <div className="meter-track">
          <div
            className="meter-fill"
            style={{ width: `${Math.min(100, (words / MAX_LESSON_WORDS) * 100)}%` }}
          />
        </div>
        <span>{chunks.length} passages</span>
      </div>
      {tooLong && <p className="error">This lesson is over the word limit. Split it into two.</p>}
      {chunks.length > 0 && (
        <details className="preview">
          <summary>Preview how it will be split</summary>
          <ol>
            {chunks.slice(0, 12).map((c) => (
              <li key={c.ordinal}>
                {c.heading && <strong>{c.heading}: </strong>}
                {c.text.split(/\s+/).slice(0, 25).join(" ")}...
              </li>
            ))}
          </ol>
          {chunks.length > 12 && (
            <p className="muted small" style={{ padding: "0 14px 12px" }}>
              and {chunks.length - 12} more
            </p>
          )}
        </details>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy || !title.trim() || words === 0 || tooLong}>
          {busy ? "Processing..." : submitLabel}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
