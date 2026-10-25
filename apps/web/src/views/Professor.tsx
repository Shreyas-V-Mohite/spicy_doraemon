import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { errorMessage, getCourseToken } from "../lib/identity";
import { studentUrl } from "../lib/links";
import { useLocalMedia } from "../lib/media";
import { useBroadcast } from "../lib/rtc";
import { useRelaySender } from "../lib/relay";
import type {
  AnswerStatus,
  LoadedMolecule,
  MoleculeStyle,
  Question,
  QueueCard,
  SlideFeedback,
} from "../types";
import { useGestures } from "../gestures/useGestures";
import WebcamBackdrop from "../gestures/WebcamBackdrop";
import { useTranscription } from "../transcribe/useTranscription";
import MoleculeView from "../viewer/MoleculeView";
import SlideView, { countPages, renderSlideForAi } from "../viewer/SlideView";
import AppHeader from "../ui/AppHeader";
import Icon, { type IconName } from "../ui/Icon";
import StatusPage from "../ui/StatusPage";
import VideoView from "../ui/VideoView";
import VoteMeter from "../ui/VoteMeter";
import SharedAnswerCard from "./SharedAnswerCard";
import StageControls, { ShareBar, type MoleculeInput, type ShareState } from "./StageControls";
import TranscriptPanel from "./TranscriptPanel";

const FLAGGED = new Set(["not_covered", "failed"]);
type Tab = "pulse" | "questions" | "molecule" | "transcript";

// The professor's live room: the shared stage (slides, 3D molecule, or the
// camera with a hand-held molecule), their own camera on air, and private
// panels for class pulse, questions that need them, molecules and transcript.
export default function Professor() {
  const { code = "" } = useParams();
  const store = useStore();
  const session = store.useSession(code);
  const token = session?.courseId ? getCourseToken(session.courseId) : null;
  const sessionId = session?._id;
  const queue = store.useProfessorQueue(sessionId, token);
  const counts = store.useFeedbackCounts(sessionId);
  const slideFeedback = store.useSlideFeedback(sessionId, token);
  const visual = store.useCurrentVisual(sessionId);
  const sharedAnswer = store.useSharedAnswer(sessionId);
  const slidesUrl = store.useSlidesUrl(sessionId);
  const lines = store.useTranscriptLines(sessionId, token);

  const media = useLocalMedia();
  const viewers = useBroadcast(store, sessionId, token, media.stream);
  const [gesturesOn, setGesturesOn] = useState(false);
  const gestures = useGestures(gesturesOn);

  // The professor's private molecule workspace (Molecule tab).
  const [stage, setStage] = useState<{ input: MoleculeInput; mol: LoadedMolecule } | null>(null);
  const [input, setInput] = useState<MoleculeInput>({ kind: "name", value: "" });
  const [groupId, setGroupId] = useState<string | null>(null);
  const [style, setStyle] = useState<MoleculeStyle>("ball-and-stick");
  const [busy, setBusy] = useState<"load" | "share" | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("pulse");
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const slideMolecules = store.useSlideMolecules(sessionId, token);

  // Students who can't connect directly get frames and audio through Convex.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const relayActive = !!media.stream && (session?.relayUntil ?? 0) > clock;
  useRelaySender(store, sessionId, token, media.stream, relayActive);

  // Claude reads every slide for molecules in the background, once per slide,
  // the one on screen first, so the gesture button can put the right one on
  // stage. Two slides at a time; a slide that fails twice is left alone.
  const askedSlides = useRef(new Set<string>());
  const failedSlides = useRef(new Map<string, number>());
  const readingNow = useRef(0);
  const [readTick, setReadTick] = useState(0);
  const slideIndexNow = session?.slideIndex ?? 0;
  const slideCountNow = session?.slideCount ?? 0;
  useEffect(() => {
    if (!sessionId || !token || !slidesUrl || slideMolecules === undefined) return;
    const done = new Set(slideMolecules.map((s) => s.slideIndex));
    const order = [slideIndexNow, slideIndexNow + 1, ...Array.from({ length: slideCountNow }, (_, i) => i)];
    for (const i of order) {
      if (readingNow.current >= 2) break;
      if (i >= slideCountNow || done.has(i)) continue;
      const key = `${slidesUrl}|${i}`;
      if (askedSlides.current.has(key) || (failedSlides.current.get(key) ?? 0) >= 2) continue;
      askedSlides.current.add(key);
      readingNow.current++;
      void renderSlideForAi(slidesUrl, i)
        .then(({ image, text }) =>
          store.detectSlideMolecules({ sessionId, token, slideIndex: i, image, text }),
        )
        .catch((err) => {
          console.warn("Reading slide molecules failed", err);
          askedSlides.current.delete(key);
          failedSlides.current.set(key, (failedSlides.current.get(key) ?? 0) + 1);
        })
        .finally(() => {
          readingNow.current--;
          setReadTick((t) => t + 1);
        });
    }
  }, [sessionId, token, slidesUrl, slideMolecules, slideIndexNow, slideCountNow, store, readTick]);

  // Molecules on the slide on screen: undefined while Claude is still reading it.
  const slideFinds =
    slideCountNow > 0 ? slideMolecules?.find((s) => s.slideIndex === slideIndexNow)?.molecules : [];
  // Set below, once the handlers exist (they need the loaded session).
  const actions = useRef({
    setHands: async (_on: boolean) => {},
    stageMolecule: async (_m: { name: string; smiles: string }) => false,
    unshare: async () => {},
  });

  // Gestures pressed while the slide was still being read: go once it's read.
  const [pendingHands, setPendingHands] = useState(false);
  useEffect(() => {
    if (!pendingHands || slideFinds === undefined) return;
    setPendingHands(false);
    void actions.current.setHands(true);
  }, [pendingHands, slideFinds]);

  // Follow the slides: each page's main molecule (as Claude read it) is put
  // in front of the class as soon as the page is shown, beside the slide,
  // on the 3D stage, or in the professor's hand. Once per page visit, so the
  // professor can still pick another molecule on the same page; a page with
  // no molecule clears it (except mid-gesture).
  const [autoFollow, setAutoFollow] = useState(true);
  const followedPage = useRef<string | null>(null);
  const visualQuery = visual?.query.toLowerCase() ?? null;
  const inHandMode = session?.handMode ?? false;
  // Shares run one at a time and only the newest page's request is kept, so
  // flipping through pages ends on the page you stopped at.
  const followNext = useRef<{ name: string; smiles: string } | "clear" | null>(null);
  const following = useRef(false);
  const runFollow = useRef(async () => {
    if (following.current) return;
    following.current = true;
    try {
      while (followNext.current) {
        const next = followNext.current;
        followNext.current = null;
        if (next === "clear") await actions.current.unshare();
        else await actions.current.stageMolecule(next);
      }
    } finally {
      following.current = false;
    }
  });
  useEffect(() => {
    if (!autoFollow || !slidesUrl || slideCountNow === 0 || slideFinds === undefined) return;
    const page = `${slidesUrl}|${slideIndexNow}`;
    if (followedPage.current === page) return;
    // Pages flipped past quickly are skipped.
    const t = window.setTimeout(() => {
      followedPage.current = page;
      const first = slideFinds[0];
      if (!first) {
        if (visualQuery && !inHandMode) followNext.current = "clear";
      } else if (following.current || visualQuery !== first.name.toLowerCase()) {
        // While another page's share is still running, ask again even if
        // this molecule is showing now: that share would replace it.
        followNext.current = first;
      } else {
        followNext.current = null;
      }
      void runFollow.current();
    }, 300);
    return () => clearTimeout(t);
  }, [autoFollow, slidesUrl, slideCountNow, slideFinds, slideIndexNow, visualQuery, inHandMode]);

  const transcription = useTranscription({
    onFinal: (text) => {
      if (sessionId && token) void store.addTranscriptLine({ sessionId, token, text });
    },
    onActiveChange: (on) => {
      if (!sessionId || !token) return;
      void store.setTranscribing({ sessionId, token, on });
      if (!on) void store.flushTranscript({ sessionId, token });
    },
  });

  // While this page's camera is on, keep the room on air: if anything turned
  // it off (another tab, a reload elsewhere), turn it back on so students
  // reconnect.
  const onAir = !!media.stream;
  const serverOnAir = session?.broadcasting ?? false;
  useEffect(() => {
    if (onAir && !serverOnAir && sessionId && token) {
      void store.setBroadcasting({ sessionId, token, on: true });
    }
  }, [onAir, serverOnAir, sessionId, token, store]);

  // Leaving or reloading the page ends the broadcast (best effort).
  const latest = useRef({ sessionId, token, onAir, store });
  useEffect(() => {
    latest.current = { sessionId, token, onAir, store };
  });
  useEffect(() => {
    const leave = () => {
      const { sessionId: id, token: t, onAir: live, store: s } = latest.current;
      if (id && t && live) void s.setBroadcasting({ sessionId: id, token: t, on: false });
    };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);

  // Arrow keys / Page Up-Down turn the slides (not while typing).
  useEffect(() => {
    if (!session || !token || session.slideCount === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const step =
        e.key === "ArrowRight" || e.key === "PageDown" ? 1 : e.key === "ArrowLeft" || e.key === "PageUp" ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      void store.setSlide({ sessionId: session._id, token, slideIndex: session.slideIndex + step });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, token, store]);

  if (session === undefined) return <StatusPage title="Loading session..." />;
  if (session === null) {
    return (
      <StatusPage
        title={`No session with code ${code}`}
        text="Check the code, or start a new session from one of your courses."
        action={{ to: "/professor", label: "Go to courses" }}
      />
    );
  }
  if (token === null) {
    return (
      <StatusPage
        title="Instructor access needed"
        text={`This browser isn't signed in as the instructor for session ${code}.`}
        action={{ to: "/professor", label: "Instructor sign-in" }}
      />
    );
  }
  const sid = session._id;

  // ----- Queue: the AI answers what the lessons cover; only the rest needs you.
  const open = queue?.filter((c) => c.open) ?? [];
  const needsYou = open.filter((c) => c.flagged);
  const aiHandled = open.filter((c) => !c.flagged);
  const done = queue?.filter((c) => !c.open) ?? [];

  async function markDone(card: QueueCard) {
    if (card.groupId) await store.markGroupAnswered({ sessionId: sid, token: token!, groupId: card.groupId });
    else await store.markAnswered({ sessionId: sid, token: token!, questionId: card.members[0]._id });
  }

  // ----- Molecules
  async function loadMolecule(next: MoleculeInput) {
    setInput(next);
    setBusy("load");
    setStageError(null);
    try {
      const mol = await store.loadMolecule({ sessionId: sid, token: token!, kind: next.kind, value: next.value });
      setStage({ input: { kind: next.kind, value: next.value.trim() }, mol });
      setGroupId(null);
    } catch (err) {
      setStageError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function shareMolecule(): Promise<boolean> {
    if (!stage) return false;
    setBusy("share");
    setStageError(null);
    try {
      await store.shareMolecule({
        sessionId: sid,
        token: token!,
        kind: stage.input.kind,
        value: stage.input.value,
        groupId: groupId ?? undefined,
        style,
      });
      return true;
    } catch (err) {
      setStageError(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const sharedCaption = visual ? (visual.groupId ? `${visual.label} in ${visual.query}` : visual.query) : null;
  const group = stage?.mol.groups.find((g) => g.id === groupId);
  const shareState: ShareState = !stage
    ? "nothing-loaded"
    : !visual
      ? "not-shared"
      : visual.query === stage.mol.query && visual.groupId === groupId && visual.style === style
        ? "shared"
        : "different";

  // The stage shows the shared molecule; turning it here turns it for everyone.
  const sendView = visual
    ? (view: number[]) => {
        store.setStageView({ sessionId: sid, token: token!, view }).catch(() => undefined);
      }
    : undefined;
  const viewSyncKey = visual ? `${sharedCaption}|${visual.style}` : null;

  const onSlide = slideFinds;

  // Loads a molecule by name (falling back to its SMILES) and shares it.
  async function stageMolecule(m: { name: string; smiles: string }): Promise<boolean> {
    setNotice(null);
    setBusy("share");
    try {
      let next: MoleculeInput = { kind: "name", value: m.name };
      let mol: LoadedMolecule;
      try {
        mol = await store.loadMolecule({ sessionId: sid, token: token!, ...next });
      } catch (err) {
        if (!m.smiles) throw err;
        next = { kind: "smiles", value: m.smiles };
        mol = await store.loadMolecule({ sessionId: sid, token: token!, ...next });
      }
      setStage({ input: next, mol });
      setInput(next);
      setGroupId(null);
      // Beside the slides: the stage stays where it is.
      await store.shareMolecule({
        sessionId: sid,
        token: token!,
        kind: next.kind,
        value: next.value,
        style,
        toStage: false,
      });
      return true;
    } catch (err) {
      setNotice(`Couldn't put ${m.name} on stage: ${errorMessage(err)}`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  // ----- Hand gestures: the camera with the molecule over it takes the stage.
  // The molecule is the one on the current slide, when Claude found one.
  async function setHands(on: boolean) {
    setNotice(null);
    if (!on) {
      setGesturesOn(false);
      await store.setHandMode({ sessionId: sid, token: token!, on: false });
      return;
    }
    if (onSlide === undefined) {
      // Still reading this slide: start as soon as it's read.
      setPendingHands(true);
      setNotice("Finding the molecule on this slide...");
      return;
    }
    const fromSlide = onSlide[0];
    if (fromSlide && visual?.query.toLowerCase() !== fromSlide.name.toLowerCase()) {
      if (!(await stageMolecule(fromSlide))) return;
    } else if (fromSlide) {
      // Already on stage.
    } else if (stage && shareState !== "shared") {
      if (!(await shareMolecule())) return;
    } else if (!visual) {
      setTab("molecule");
      setNotice("No molecule found on this slide. Load one in the Molecule tab, then turn on hand gestures.");
      return;
    }
    setNotice(null);
    setGesturesOn(true);
    await store.setHandMode({ sessionId: sid, token: token!, on: true });
  }
  actions.current = {
    setHands,
    stageMolecule,
    unshare: () => store.unshareMolecule({ sessionId: sid, token: token! }),
  };

  // ----- On air
  async function goLive() {
    if (await media.start()) await store.setBroadcasting({ sessionId: sid, token: token!, on: true });
  }
  async function endLive() {
    media.stop();
    await store.setBroadcasting({ sessionId: sid, token: token!, on: false });
  }

  async function uploadSlides(file: File | undefined) {
    if (!file) return;
    setNotice(null);
    setUploading(true);
    try {
      const slideCount = await countPages(file);
      await store.uploadSlides({ sessionId: sid, token: token!, file, slideCount });
    } catch (err) {
      setNotice(err instanceof Error && err.message !== "Upload failed" ? errorMessage(err) : "That file couldn't be used. Export your slides as a PDF and try again.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(studentUrl(session!.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Send this link to your students:", studentUrl(session!.code));
    }
  }

  const goTo = (slideIndex: number) => void store.setSlide({ sessionId: sid, token: token!, slideIndex });
  // The room's hand mode is shared; this page may still need to start tracking.
  const handsLive = session.handMode;
  const mode: "hands" | "molecule" | "slides" = handsLive ? "hands" : session.stageMode === "molecule" ? "molecule" : "slides";
  const listening = transcription.status === "listening";

  const slideOrEmpty = (small: boolean) =>
    slidesUrl ? (
      <SlideView url={slidesUrl} index={session.slideIndex} />
    ) : (
      <div className="stage-empty">
        {!small && (
          <div className="empty-icon">
            <Icon name="slides" size={20} />
          </div>
        )}
        <strong>No slides yet</strong>
        {!small && (
          <>
            <span>Upload your deck as a PDF. Students see the page you're on.</span>
            <button className="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
              <Icon name="upload" size={14} />
              {uploading ? "Uploading..." : "Upload slides (PDF)"}
            </button>
          </>
        )}
      </div>
    );

  const camera = media.stream ? (
    <VideoView stream={media.stream} muted mirrored className="cover" />
  ) : (
    <div className="stage-empty dark">
      <Icon name="video-off" size={18} />
      <span>Camera off</span>
    </div>
  );

  return (
    <div className="room-page">
      <AppHeader wide>
        {listening && <span className="live-dot on">Transcribing</span>}
        <span className="code-badge" title="Class code">
          {session.code}
        </span>
        <button className="secondary sm" onClick={copyLink}>
          <Icon name={copied ? "check" : "link"} size={14} />
          {copied ? "Link copied" : "Copy student link"}
        </button>
      </AppHeader>

      <main className="room">
        <div className="room-top">
          {session.courseId && (
            <Link to={`/professor/course/${session.courseId}`} className="back-link" style={{ margin: 0 }}>
              <Icon name="arrow-left" />
            </Link>
          )}
          <h1>{session.topic}</h1>
          {media.stream && session.broadcasting ? (
            <span className="badge danger">
              <span className="live-dot on" /> LIVE
            </span>
          ) : media.stream ? (
            <span className="badge warn">Reconnecting...</span>
          ) : (
            <span className="badge">Off air</span>
          )}
          <span className="muted small row" style={{ gap: 6 }}>
            <Icon name="users" size={14} />
            {viewers} watching
          </span>
          {relayActive && (
            <span className="badge accent" title="Some students can't connect directly; they get a lighter feed through the server">
              Low-bandwidth feed on
            </span>
          )}
        </div>

        <div className="room-grid">
          <section className="stage-panel card">
            <div className="stage-head">
              <span className="stage-title">
                {mode === "hands"
                  ? `Hand gestures: ${sharedCaption ?? ""}`
                  : mode === "molecule"
                    ? (sharedCaption ?? "3D molecule")
                    : session.slideCount > 0
                      ? `Slide ${session.slideIndex + 1} of ${session.slideCount}`
                      : "Slides"}
              </span>
              <span className="badge accent">Students see this</span>
              <span className="spacer" />
              <div className="segmented" role="group" aria-label="Stage">
                {(["slides", "molecule"] as const).map((m) => (
                  <button
                    key={m}
                    className={!handsLive && session.stageMode === m ? "active" : undefined}
                    disabled={handsLive}
                    onClick={() => void store.setStageMode({ sessionId: sid, token: token!, stageMode: m })}
                  >
                    {m === "slides" ? "Slides" : "3D"}
                  </button>
                ))}
              </div>
            </div>

            <div className={mode === "hands" ? "stage-frame dark" : "stage-frame"}>
              {mode === "slides" && slideOrEmpty(false)}
              {mode === "molecule" &&
                (visual ? (
                  <MoleculeView
                    sdf={visual.sdf}
                    highlight={visual.indices}
                    style={visual.style}
                    onViewChange={sendView}
                    syncKey={viewSyncKey}
                  />
                ) : (
                  <div className="stage-empty">
                    <div className="empty-icon">
                      <Icon name="cube" size={20} />
                    </div>
                    <strong>No molecule on stage</strong>
                    <span>Load one in the Molecule tab and share it with the class.</span>
                    <button className="sm" onClick={() => setTab("molecule")}>
                      Open Molecule tab
                    </button>
                  </div>
                ))}
              {mode === "hands" && visual && (
                <MoleculeView
                  sdf={visual.sdf}
                  highlight={visual.indices}
                  style={visual.style}
                  controller={gestures.controller}
                  backdrop={gestures.controller ? <WebcamBackdrop controller={gestures.controller} /> : undefined}
                  onViewChange={sendView}
                  syncKey={viewSyncKey}
                />
              )}

              {mode === "slides" && session.slideCount > 0 && (
                <div className="slide-nav">
                  <button
                    className="icon-only secondary"
                    aria-label="Previous slide"
                    disabled={session.slideIndex === 0}
                    onClick={() => goTo(session.slideIndex - 1)}
                  >
                    <Icon name="chevron-left" />
                  </button>
                  <span>
                    {session.slideIndex + 1} / {session.slideCount}
                  </span>
                  <button
                    className="icon-only secondary"
                    aria-label="Next slide"
                    disabled={session.slideIndex >= session.slideCount - 1}
                    onClick={() => goTo(session.slideIndex + 1)}
                  >
                    <Icon name="chevron-right" />
                  </button>
                </div>
              )}

              {/* Call controls float over the stage, as in a video call: they
                  show while the pointer is on the stage (always before going live). */}
              <div className={media.stream ? "stage-dock" : "stage-dock pinned"}>
                <DockButton
                  icon={media.micOn || !media.stream ? "mic" : "mic-off"}
                  label={media.micOn ? "Mic" : "Muted"}
                  active={!!media.stream && media.micOn}
                  disabled={!media.stream}
                  onClick={media.toggleMic}
                />
                <DockButton
                  icon={media.camOn || !media.stream ? "video" : "video-off"}
                  label={media.camOn ? "Camera" : "Camera off"}
                  active={!!media.stream && media.camOn}
                  disabled={!media.stream}
                  onClick={media.toggleCam}
                />
                <DockButton
                  icon="hand"
                  label={handsLive ? "Gestures on" : "Gestures"}
                  active={handsLive}
                  onClick={() => void setHands(!handsLive)}
                />
                <DockButton
                  icon="captions"
                  label={listening ? "Transcribing" : "Transcribe"}
                  active={listening}
                  disabled={!transcription.supported}
                  onClick={listening ? transcription.stop : transcription.start}
                />
                <DockButton
                  icon="upload"
                  label={uploading ? "Uploading" : session.hasSlides ? "Slides" : "Add slides"}
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                />
                {media.stream ? (
                  <button className="dock-live end" onClick={() => void endLive()}>
                    <Icon name="x" />
                    End
                  </button>
                ) : (
                  <button className="dock-live" onClick={() => void goLive()}>
                    <Icon name="radio" />
                    Go live
                  </button>
                )}
              </div>
            </div>
            {mode === "slides" && session.slideCount > 0 && (
              <div className="slide-ai">
                <span className="control-label">On this slide</span>
                {onSlide === undefined ? (
                  <span className="thinking">
                    <i />
                    <i />
                    <i />
                    Finding molecules
                  </span>
                ) : onSlide.length === 0 ? (
                  <span className="muted small">No molecules found</span>
                ) : (
                  <>
                    {onSlide.map((m) => (
                      <button
                        key={m.name}
                        className={visualQuery === m.name.toLowerCase() ? "chip active" : "chip"}
                        disabled={busy !== null}
                        onClick={() => void stageMolecule(m)}
                        title="Show this one as the slide's 3D model"
                      >
                        {m.name}
                      </button>
                    ))}
                    <span className="spacer" />
                    <button className="sm" disabled={busy !== null} onClick={() => void setHands(true)}>
                      <Icon name="hand" size={14} />
                      Present {onSlide[0].name} with hands
                    </button>
                  </>
                )}
                <label className="auto-toggle" title="Show each page's molecule automatically when the page changes">
                  <input type="checkbox" checked={autoFollow} onChange={(e) => setAutoFollow(e.target.checked)} />
                  Auto
                </label>
              </div>
            )}
            {/* The page's molecule in 3D under the slide; students see it too. */}
            {mode === "slides" && session.slideCount > 0 && visual && (
              <div className="companion">
                <div className="viewer-head">
                  <span className="caption">{sharedCaption}</span>
                  {busy === "share" ? (
                    <span className="thinking">
                      <i />
                      <i />
                      <i />
                      Loading the next molecule
                    </span>
                  ) : (
                    <span className="badge ok">On students' screens, turns with you</span>
                  )}
                </div>
                <MoleculeView
                  sdf={visual.sdf}
                  highlight={visual.indices}
                  style={visual.style}
                  onViewChange={sendView}
                  syncKey={viewSyncKey}
                />
              </div>
            )}
            {mode === "hands" && !gesturesOn && (
              <div className="notice accent row" style={{ margin: 12 }}>
                <span className="spacer">Hand tracking is off on this page.</span>
                <button className="sm" onClick={() => setGesturesOn(true)}>
                  <Icon name="hand" size={14} />
                  Start tracking
                </button>
              </div>
            )}
            {mode === "hands" && gesturesOn && gestures.phase !== "running" && (
              <p className="notice accent" style={{ margin: 12 }}>
                {gestures.error ?? "Starting hand tracking. Allow the camera when your browser asks."}
              </p>
            )}
          </section>

          <div className="room-side-col">
          {/* Camera beside the stage; in hand mode it swaps with the slides. */}
          <div className="side-tile">
            {mode === "hands" ? slideOrEmpty(true) : camera}
            <span className="pip-label">{mode === "hands" ? "Slides" : "You"}</span>
          </div>
          <aside className="card side-panel room-side">
            <div className="tabs" role="tablist">
              <TabButton tab="pulse" current={tab} onSelect={setTab} label="Pulse" />
              <TabButton
                tab="questions"
                current={tab}
                onSelect={setTab}
                label="Questions"
                count={needsYou.length}
                warn={needsYou.length > 0}
              />
              <TabButton tab="molecule" current={tab} onSelect={setTab} label="Molecule" />
              <TabButton tab="transcript" current={tab} onSelect={setTab} label="Transcript" live={listening} />
            </div>
            <div className="side-scroll">
              {tab === "pulse" && (
                <PulsePanel
                  counts={counts}
                  hasSlides={session.slideCount > 0}
                  slideIndex={session.slideIndex}
                  bySlide={slideFeedback}
                  questionsBySlide={countQuestionsBySlide(queue)}
                  onGoTo={goTo}
                  onReset={() => void store.resetFeedback({ sessionId: sid, token: token! })}
                />
              )}
              {tab === "questions" && (
                <div className="queue">
                  {sharedAnswer && (
                    <SharedAnswerCard
                      shared={sharedAnswer}
                      action={
                        <button
                          className="secondary sm"
                          onClick={() => store.stopSharingAnswer({ sessionId: sid, token: token! })}
                        >
                          Stop sharing
                        </button>
                      }
                    />
                  )}
                  <h3 className="queue-heading">Needs you</h3>
                  {queue === undefined && <p className="muted small">Loading...</p>}
                  {queue && needsYou.length === 0 && (
                    <p className="muted small">
                      Nothing right now. Questions your lessons can't answer appear here.
                    </p>
                  )}
                  {needsYou.map((card) => (
                    <QuestionCard
                      key={card.key}
                      card={card}
                      onDone={() => markDone(card)}
                      onShareAnswer={(questionId) => store.shareAnswer({ sessionId: sid, token: token!, questionId })}
                      onSplit={(questionId) => store.splitFromGroup({ sessionId: sid, token: token!, questionId })}
                      onReply={(questionId, text) => store.replyToQuestion({ sessionId: sid, token: token!, questionId, text })}
                    />
                  ))}
                  {aiHandled.length > 0 && (
                    <details className="answered-list" style={{ padding: 0 }}>
                      <summary>Answered by AI ({aiHandled.length})</summary>
                      <div className="queue" style={{ padding: "8px 0 0" }}>
                        {aiHandled.map((card) => (
                          <QuestionCard
                            key={card.key}
                            card={card}
                            onDone={() => markDone(card)}
                            onShareAnswer={(questionId) =>
                              store.shareAnswer({ sessionId: sid, token: token!, questionId })
                            }
                            onSplit={(questionId) =>
                              store.splitFromGroup({ sessionId: sid, token: token!, questionId })
                            }
                            onReply={(questionId, text) =>
                              store.replyToQuestion({ sessionId: sid, token: token!, questionId, text })
                            }
                          />
                        ))}
                      </div>
                    </details>
                  )}
                  {done.length > 0 && (
                    <details className="answered-list" style={{ padding: 0 }}>
                      <summary>Done ({done.length})</summary>
                      <ul>
                        {done.map((card) => (
                          <li key={card.key}>
                            <Icon name="check" size={14} />
                            <span style={{ flex: 1 }}>{card.label ?? card.members[0].text}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
              {tab === "molecule" && (
                <div>
                  <StageControls
                    input={input}
                    onInput={setInput}
                    onLoad={loadMolecule}
                    loading={busy === "load"}
                    groups={stage ? stage.mol.groups : null}
                    groupId={groupId}
                    onGroup={setGroupId}
                    style={style}
                    onStyle={setStyle}
                    error={stageError}
                  />
                  {stage ? (
                    <div className="mol-preview">
                      <div className="viewer-head">
                        <span className="caption">
                          {group ? `${group.label} in ${stage.mol.query}` : stage.mol.query}
                        </span>
                        <span className={shareState === "shared" ? "badge ok" : "badge"}>
                          {shareState === "shared" ? "On stage" : "Preview"}
                        </span>
                      </div>
                      <MoleculeView sdf={stage.mol.sdf} highlight={group?.indices ?? []} style={style} />
                    </div>
                  ) : (
                    <p className="muted small" style={{ padding: "0 18px 16px" }}>
                      Load a molecule to preview it here. Only you see the preview until you share it.
                    </p>
                  )}
                  <ShareBar
                    shareState={shareState}
                    sharedCaption={sharedCaption}
                    sharing={busy === "share"}
                    onShare={() => void shareMolecule()}
                    onUnshare={() => store.unshareMolecule({ sessionId: sid, token: token! })}
                  />
                </div>
              )}
              {tab === "transcript" && (
                <TranscriptPanel
                  status={transcription.status}
                  detail={transcription.detail}
                  interim={transcription.interim}
                  supported={transcription.supported}
                  lines={lines}
                  onStart={transcription.start}
                  onPause={transcription.stop}
                  onEdit={(lineId, text) => store.editTranscriptLine({ sessionId: sid, token: token!, lineId, text })}
                  onDelete={(lineId) => store.deleteTranscriptLine({ sessionId: sid, token: token!, lineId })}
                  onClear={() => store.clearTranscript({ sessionId: sid, token: token! })}
                />
              )}
            </div>
          </aside>
          </div>
        </div>

        {(notice || media.error) && <p className="notice warn">{notice ?? media.error}</p>}
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => void uploadSlides(e.target.files?.[0])}
        />
      </main>
    </div>
  );
}

function TabButton({
  tab,
  current,
  onSelect,
  label,
  count,
  warn,
  live,
}: {
  tab: Tab;
  current: Tab;
  onSelect: (t: Tab) => void;
  label: string;
  count?: number;
  warn?: boolean;
  live?: boolean;
}) {
  return (
    <button
      role="tab"
      aria-selected={tab === current}
      className={tab === current ? "active" : undefined}
      onClick={() => onSelect(tab)}
    >
      {label}
      {count !== undefined && count > 0 && <span className={warn ? "tab-count warn" : "tab-count"}>{count}</span>}
      {live && <span className="live-dot on" aria-label="Live" />}
    </button>
  );
}

function DockButton({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={active ? "dock-btn active" : "dock-btn"} disabled={disabled} onClick={onClick}>
      <span className="dock-icon">
        <Icon name={icon} size={18} />
      </span>
      {label}
    </button>
  );
}

function countQuestionsBySlide(queue: QueueCard[] | undefined): Map<number, number> {
  const out = new Map<number, number>();
  for (const card of queue ?? []) {
    for (const m of card.members) {
      if (m.slideIndex !== null) out.set(m.slideIndex, (out.get(m.slideIndex) ?? 0) + 1);
    }
  }
  return out;
}

// Is the class with you right now, and which slides lost them.
function PulsePanel({
  counts,
  hasSlides,
  slideIndex,
  bySlide,
  questionsBySlide,
  onGoTo,
  onReset,
}: {
  counts: { confused: number; understood: number } | undefined;
  hasSlides: boolean;
  slideIndex: number;
  bySlide: SlideFeedback[] | undefined;
  questionsBySlide: Map<number, number>;
  onGoTo: (slideIndex: number) => void;
  onReset: () => void;
}) {
  const slides = new Set([...(bySlide ?? []).map((s) => s.slideIndex), ...questionsBySlide.keys()]);
  const rows = [...slides]
    .sort((a, b) => a - b)
    .map((i) => {
      const f = bySlide?.find((s) => s.slideIndex === i);
      return { slideIndex: i, confused: f?.confused ?? 0, understood: f?.understood ?? 0, questions: questionsBySlide.get(i) ?? 0 };
    })
    .filter((r) => r.confused > 0 || r.questions > 0);
  const worst = Math.max(1, ...rows.map((r) => r.confused));
  return (
    <div className="pulse">
      <div className="card votes-card">
        <VoteMeter counts={counts} />
        <div className="row" style={{ marginTop: 10 }}>
          <span className="muted small">{hasSlides ? `On slide ${slideIndex + 1}` : "Whole session"}</span>
          <span className="spacer" />
          <button className="ghost sm" onClick={onReset}>
            <Icon name="reset" size={14} />
            Reset
          </button>
        </div>
      </div>

      <h3 className="queue-heading">Where the class got lost</h3>
      {!hasSlides ? (
        <p className="muted small">Upload slides to see confusion slide by slide.</p>
      ) : rows.length === 0 ? (
        <p className="muted small">No confused votes or questions yet.</p>
      ) : (
        <ul className="lost-list">
          {rows.map((r) => (
            <li key={r.slideIndex} className={r.confused === worst && r.confused > 0 ? "worst" : undefined}>
              <button className="ghost sm" onClick={() => onGoTo(r.slideIndex)} title="Go to this slide">
                Slide {r.slideIndex + 1}
              </button>
              <div className="lost-bar">
                <div style={{ width: `${(r.confused / worst) * 100}%` }} />
              </div>
              <span className="lost-meta">
                {r.confused} confused
                {r.questions > 0 && `, ${r.questions} ${r.questions === 1 ? "question" : "questions"}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AnswerStatus | null }) {
  switch (status) {
    case "answered":
      return <span className="badge ok">Answered by AI</span>;
    case "fallback":
      return <span className="badge accent">Closest passage</span>;
    case "not_covered":
      return <span className="badge warn">Not in lessons</span>;
    case "failed":
      return <span className="badge danger">Couldn't answer</span>;
    default:
      return <span className="badge">Answering...</span>;
  }
}

function QuestionCard({
  card,
  onDone,
  onSplit,
  onShareAnswer,
  onReply,
}: {
  card: QueueCard;
  onDone: () => void;
  onSplit: (questionId: string) => void;
  onShareAnswer: (questionId: string) => Promise<void>;
  onReply: (questionId: string, text: string) => Promise<void>;
}) {
  const grouped = card.members.length > 1;
  const openMembers = card.members.filter((m) => m.status === "open");
  // Show the question that needs attention (a student asked for you, or the
  // lessons had no answer), else the original (oldest) one.
  const rep =
    openMembers.find((m) => m.escalated) ??
    openMembers.find((m) => FLAGGED.has(m.answerStatus ?? "")) ??
    card.members[card.members.length - 1];
  // Only an answer the student actually saw can be shared with the class.
  const shareable = [rep, ...card.members].find(
    (m) => m.answerStatus === "answered" || m.answerStatus === "fallback",
  );
  return (
    <div className={card.flagged ? "card q-card flagged" : "card q-card"}>
      <div className="q-head">
        <p className="q-text">{card.label ?? rep.text}</p>
        {card.studentCount > 1 && (
          <span className="badge warn" title="Distinct students who asked this">
            {card.studentCount} students
          </span>
        )}
      </div>
      <div className="row">
        <StatusBadge status={rep.answerStatus} />
        {rep.escalated && <span className="badge danger">Asked for you</span>}
        {rep.slideIndex !== null && <span className="badge">Slide {rep.slideIndex + 1}</span>}
      </div>
      <AnswerLine question={rep} />
      {rep.escalated && (
        <p className="notice warn">
          The student read the AI answer and still wants you
          {rep.escalationNote ? `: "${rep.escalationNote}"` : "."}
        </p>
      )}
      {rep.professorReply && (
        <blockquote className="quote">
          {rep.professorReply}
          <cite>Your reply, sent to this student</cite>
        </blockquote>
      )}
      <ReplyBox replied={!!rep.professorReply} onSend={(text) => onReply(rep._id, text)} />
      {grouped && (
        <details>
          <summary>See all {card.members.length} questions</summary>
          <ul className="q-members">
            {card.members.map((m) => (
              <li key={m._id}>
                <span>{m.text}</span>
                <button
                  className="ghost sm"
                  onClick={() => onSplit(m._id)}
                  title="This question is not the same as the others"
                >
                  Split out
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="row">
        {shareable && (
          <button className="sm" onClick={() => void onShareAnswer(shareable._id)}>
            <Icon name="send" size={14} />
            Share with class
          </button>
        )}
        <button className="secondary sm" onClick={onDone}>
          <Icon name="check" size={14} />
          {grouped ? "Mark all answered" : "Mark answered"}
        </button>
      </div>
    </div>
  );
}

// Answer one student directly, in writing; only they see it.
function ReplyBox({ replied, onSend }: { replied: boolean; onSend: (text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button className="ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        <Icon name="message" size={14} />
        {replied ? "Reply again" : "Reply to student"}
      </button>
    );
  }
  return (
    <form
      className="stack"
      style={{ gap: 8 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setSending(true);
        setError(null);
        try {
          await onSend(text);
          setText("");
          setOpen(false);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setSending(false);
        }
      }}
    >
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write your answer. Only this student sees it."
        autoFocus
      />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="sm" disabled={sending || !text.trim()}>
          <Icon name="send" size={14} />
          {sending ? "Sending..." : "Send reply"}
        </button>
        <button type="button" className="ghost sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AnswerLine({ question }: { question: Question }) {
  const status = question.answerStatus;
  if (status === null || status === "pending") {
    return (
      <span className="thinking">
        <i />
        <i />
        <i />
        Searching your lessons
      </span>
    );
  }
  if (FLAGGED.has(status)) {
    return (
      <p className="q-answer">
        {status === "failed" ? "The automatic answer failed" : "Your lessons don't cover this"}
        {question.answerNote ? ` (${question.answerNote})` : ""}. The student was told you've been
        notified.
      </p>
    );
  }
  return (
    <details open={question.answerConflict}>
      <summary>{status === "fallback" ? "Show the closest passage" : "Show the answer students saw"}</summary>
      {question.answerConflict && (
        <p className="notice warn" style={{ marginBottom: 8 }}>
          {question.answerNote}
        </p>
      )}
      <p className="q-answer">{question.answerText}</p>
    </details>
  );
}
