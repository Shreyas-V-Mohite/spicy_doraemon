import { useMemo, useState } from "react";
import {
  chunkLesson,
  countWords,
  MAX_LESSON_WORDS,
} from "../../../../convex/lib/chunk";

interface Props {
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
  const words = countWords(text);
  const chunks = useMemo(() => chunkLesson(text), [text]);
  const tooLong = words > MAX_LESSON_WORDS;

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setText(await file.text());
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
      <label>
        Lesson title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Upload a .md or .txt file
        <input
          type="file"
          accept=".md,.txt,text/markdown,text/plain"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
      </label>
      <label>
        Or paste the lesson
        <textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className={tooLong ? "error" : "muted"}>
        {words.toLocaleString()} words · {chunks.length} passages
        {tooLong && ` (limit ${MAX_LESSON_WORDS.toLocaleString()} words)`}
      </p>
      {chunks.length > 0 && (
        <details>
          <summary>Preview passages</summary>
          <ol className="list">
            {chunks.slice(0, 12).map((c) => (
              <li key={c.ordinal}>
                {c.heading && <strong>{c.heading}: </strong>}
                {c.text.split(/\s+/).slice(0, 25).join(" ")}…
              </li>
            ))}
          </ol>
          {chunks.length > 12 && (
            <p className="muted">and {chunks.length - 12} more</p>
          )}
        </details>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy || !title.trim() || words === 0 || tooLong}>
          {busy ? "Embedding…" : submitLabel}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
