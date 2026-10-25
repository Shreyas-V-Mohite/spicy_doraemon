import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { Logo } from "../ui/AppHeader";
import Icon from "../ui/Icon";
import StatusPage from "../ui/StatusPage";
import Stage, { type ShownMolecule } from "./Stage";

// The screen to share in a video call or put on a projector. Opened in its own
// window from the professor's page, it has no controls: it shows what the
// class sees (the shared molecule, turning with the professor's view) so the
// professor's clicking stays off screen.
export default function Presenter() {
  const { code = "" } = useParams();
  const store = useStore();
  const session = store.useSession(code);
  const counts = store.useFeedbackCounts(session?._id);
  const visual = store.useCurrentVisual(session?._id);
  const stageView = store.useStageView(session?._id);
  const sharedAnswer = store.useSharedAnswer(session?._id);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (session === undefined) return <StatusPage title="Loading..." />;
  if (session === null) return <StatusPage title={`No session with code ${code}`} />;

  const shown: ShownMolecule | null = visual
    ? {
        sdf: visual.sdf,
        indices: visual.indices,
        style: visual.style,
        caption: visual.groupId ? `${visual.label} in ${visual.query}` : visual.query,
      }
    : null;

  return (
    <div className="present-mode">
      <header className="app-header">
        <div className="app-header-inner wide">
          <Logo />
          <div className="app-header-actions">
            {session.transcribing && <span className="live-dot on">Transcribing</span>}
            {!fullscreen && (
              <button
                className="ghost sm"
                onClick={() => void document.documentElement.requestFullscreen?.()}
              >
                <Icon name="monitor" size={14} />
                Full screen
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="container wide">
        <div className="session-bar">
          <div className="session-title">
            <h1>{session.topic}</h1>
          </div>
        </div>
        <Stage
          session={session}
          counts={counts}
          present
          shown={shown}
          sharedAnswer={sharedAnswer}
          followView={stageView}
        />
      </main>
    </div>
  );
}
