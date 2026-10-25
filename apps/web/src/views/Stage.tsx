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
import { studentUrl } from "../lib/links";
import MoleculeView from "../viewer/MoleculeView";
import Icon from "../ui/Icon";
import VoteMeter from "../ui/VoteMeter";
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
  shareBar?: ReactNode;
  status?: ReactNode;
  onStopSharingAnswer?: () => void;
  // While the shown molecule is the shared one: its camera goes to students.
  onViewChange?: (view: number[]) => void;
  viewSyncKey?: string | null;
  // Presenter screen: follow the professor's camera instead.
  followView?: readonly number[] | null;
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
  shareBar,
  status,
  onStopSharingAnswer,
  onViewChange,
  viewSyncKey,
  followView,
}: Props) {
  const joinUrl = studentUrl(session.code);
  const displayUrl = joinUrl.replace(/^https?:\/\//, "");
  return (
    <div className="stage">
      <div className="card join-strip">
        <div className="qr">
          <QRCodeSVG
            value={joinUrl}
            size={present ? 200 : 84}
            bgColor="#ffffff"
            fgColor="#000000"
            marginSize={1}
          />
        </div>
        <div className="join-text">
          <p className="join-label">Scan or go to</p>
          <p className="join-url">{displayUrl}</p>
        </div>
        <div className="join-code-wrap">
          <p className="join-label">Class code</p>
          <p className="join-code">{session.code}</p>
        </div>
      </div>

      <div className="card viewer-card">
        {controls}
        {shareBar}
        <div className="viewer-head">
          <span className="caption">{shown ? shown.caption : "Molecule"}</span>
          {status}
        </div>
        {shown ? (
          <MoleculeView
            sdf={shown.sdf}
            highlight={shown.indices}
            style={shown.style}
            controller={gestures}
            backdrop={gestures ? <WebcamBackdrop controller={gestures} /> : undefined}
            onViewChange={onViewChange}
            syncKey={viewSyncKey}
            followView={followView}
          />
        ) : (
          <div className="empty viewer-empty">
            <div className="empty-icon">
              <Icon name="cube" size={20} />
            </div>
            <strong>{present ? "No molecule on screen yet" : "No molecule loaded"}</strong>
            {!present && <span>Search by name or SMILES above, or pick an example.</span>}
          </div>
        )}
      </div>

      {sharedAnswer && (
        <SharedAnswerCard
          shared={sharedAnswer}
          action={
            onStopSharingAnswer && (
              <button className="secondary sm" onClick={onStopSharingAnswer}>
                Stop sharing
              </button>
            )
          }
        />
      )}

      <div className="card votes-card">
        <VoteMeter counts={counts} />
      </div>
    </div>
  );
}
