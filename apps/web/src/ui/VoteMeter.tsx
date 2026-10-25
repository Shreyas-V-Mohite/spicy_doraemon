import type { FeedbackCounts } from "../types";

// Confused versus understood, as counts and one proportional bar.
export default function VoteMeter({ counts }: { counts: FeedbackCounts | undefined }) {
  const confused = counts?.confused ?? 0;
  const understood = counts?.understood ?? 0;
  const total = confused + understood;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <div className="vote-meter">
      <div className="vm-head">
        <h3>Class pulse</h3>
        <span className="muted small">
          {total === 0 ? "No votes yet" : `${total} ${total === 1 ? "vote" : "votes"}`}
        </span>
      </div>
      <div className="vote-bar" role="img" aria-label={`${confused} confused, ${understood} understood`}>
        <div className="c" style={{ width: `${pct(confused)}%` }} />
        <div className="u" style={{ width: `${pct(understood)}%` }} />
      </div>
      <div className="vote-legend">
        <span>
          <i style={{ background: "var(--warn)" }} />
          Confused <strong>{confused}</strong>
        </span>
        <span>
          <i style={{ background: "var(--ok)" }} />
          Understood <strong>{understood}</strong>
        </span>
      </div>
    </div>
  );
}
