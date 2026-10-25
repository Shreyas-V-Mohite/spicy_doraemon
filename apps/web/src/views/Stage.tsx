import { QRCodeSVG } from "qrcode.react";
import type { FeedbackCounts, PublicSession, Visual } from "../types";
import MoleculeView from "../viewer/MoleculeView";

interface Props {
  session: PublicSession;
  counts: FeedbackCounts | undefined;
  visual: Visual | null | undefined;
  present: boolean;
}

// What the class sees: how to join, the shared molecule, and the vote counts.
// Nothing private lives here, so it is safe to screen-share.
export default function Stage({ session, counts, visual, present }: Props) {
  const joinUrl = `${window.location.origin}/s/${session.code}`;
  return (
    <div className="stage-card">
      <div className="join">
        <div className="qr">
          <QRCodeSVG
            value={joinUrl}
            size={present ? 168 : 96}
            bgColor="#ffffff"
            fgColor="#000000"
            marginSize={1}
          />
        </div>
        <div>
          <p className="muted">Join at</p>
          <p className="join-url">{joinUrl}</p>
          <p>
            Code <strong className="code">{session.code}</strong>
          </p>
        </div>
      </div>

      {visual ? (
        <>
          <p className="caption">
            {visual.label} in {visual.query}
          </p>
          <MoleculeView sdf={visual.sdf} highlight={visual.indices} />
        </>
      ) : (
        <p className="muted stage-empty">Nothing is being shared yet.</p>
      )}

      <div className="counts">
        <span className="pill confused">Confused {counts?.confused ?? 0}</span>
        <span className="pill understood">
          Understood {counts?.understood ?? 0}
        </span>
      </div>
    </div>
  );
}
