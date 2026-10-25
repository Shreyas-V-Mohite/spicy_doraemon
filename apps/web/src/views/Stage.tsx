import type { ReactNode } from "react";
import type { HandGestureController } from "@spicy/hand-gesture";
import { QRCodeSVG } from "qrcode.react";
import type {
  FeedbackCounts,
  MoleculeStyle,
  PublicSession,
  SharedAnswer,
} from "../types";
import WebcamBackdrop from "../gestures/WebcamBackdrop";
import MoleculeView from "../viewer/MoleculeView";
import SharedAnswerCard from "./SharedAnswerCard";

export interface ShownMolecule {
  sdf: string;
  indices: number[];
  style: MoleculeStyle;
  caption: string;
}

interface Props {
  session: PublicSession;
  counts: FeedbackCounts | undefined;
  present: boolean;
  shown: ShownMolecule | null;
  sharedAnswer: SharedAnswer | null | undefined;
  // Hand tracking, when the professor has gestures on.
  gestures?: HandGestureController | null;
  // Professor-only pieces, left out in Present mode.
  controls?: ReactNode;
  onStopSharingAnswer?: () => void;
}

// The class screen: how to join, the molecule on stage, a shared answer, and
// the vote counts. Controls are passed in so Present mode can drop them.
export default function Stage({
  session,
  counts,
  present,
  shown,
  sharedAnswer,
  gestures,
  controls,
  onStopSharingAnswer,
}: Props) {
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

      {controls}

      {shown ? (
        <>
          <p className="caption">{shown.caption}</p>
          <MoleculeView
            sdf={shown.sdf}
            highlight={shown.indices}
            style={shown.style}
            controller={gestures}
            backdrop={gestures ? <WebcamBackdrop controller={gestures} /> : undefined}
          />
        </>
      ) : (
        <p className="muted stage-empty">No molecule on stage yet.</p>
      )}

      {sharedAnswer && (
        <>
          <SharedAnswerCard shared={sharedAnswer} />
          {onStopSharingAnswer && (
            <button className="secondary" onClick={onStopSharingAnswer}>
              Stop sharing this answer
            </button>
          )}
        </>
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
