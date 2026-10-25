import type { SharedAnswer } from "../types";

// An answer the professor chose to put in front of the whole class.
// Anonymous: it carries the question and answer, never who asked.
export default function SharedAnswerCard({ shared }: { shared: SharedAnswer }) {
  return (
    <div className="shared-answer">
      <p className="muted">Shared with the class</p>
      <p>
        <strong>{shared.question}</strong>
      </p>
      <p>{shared.answer}</p>
      {shared.quotes.map((q, i) => (
        <blockquote key={i} className="quote">
          {q.text}
          <cite>From {q.label}</cite>
        </blockquote>
      ))}
    </div>
  );
}
