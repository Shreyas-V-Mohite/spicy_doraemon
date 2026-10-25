import type { ReactNode } from "react";
import type { SharedAnswer } from "../types";
import Icon from "../ui/Icon";

// An answer the professor chose to put in front of the whole class.
// Anonymous: it carries the question and answer, never who asked.
export default function SharedAnswerCard({
  shared,
  action,
}: {
  shared: SharedAnswer;
  action?: ReactNode;
}) {
  return (
    <div className="card shared-answer">
      <div className="row">
        <span className="badge accent">Shared with the class</span>
        <span className="spacer" />
        {action}
      </div>
      <p className="sa-question">{shared.question}</p>
      <p>{shared.answer}</p>
      {shared.quotes.map((q, i) => (
        <blockquote key={i} className="quote">
          {q.text}
          <cite>
            <Icon name="shield" size={12} />
            Verified quote from {q.label}
          </cite>
        </blockquote>
      ))}
    </div>
  );
}
