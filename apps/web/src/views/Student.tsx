import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { errorMessage, getStudentId } from "../lib/identity";
import { useReceiver } from "../lib/rtc";
import { useRelayAudio, useRelayFrame } from "../lib/relay";
import type { FeedbackValue, MyQuestion } from "../types";
import { useGestures } from "../gestures/useGestures";
import { useDictation } from "../transcribe/useDictation";
import WebcamBackdrop from "../gestures/WebcamBackdrop";
import MoleculeView from "../viewer/MoleculeView";
import SlideView from "../viewer/SlideView";
import AppHeader from "../ui/AppHeader";
import Icon from "../ui/Icon";
import StatusPage from "../ui/StatusPage";
import VideoView from "../ui/VideoView";
import SharedAnswerCard from "./SharedAnswerCard";

const MAX_QUESTION = 500;

// The student's live room: the professor's stage and camera, a pulse vote for
// the slide on screen, and questions answered straight from the lessons.
export default function Student() {
  const { code = "" } = useParams();
  const store = useStore();
  const studentId = getStudentId();
  const session = store.useSession(code);
  const sessionId = session?._id;
  const mine = store.useMyQuestions(sessionId, studentId);
  const visual = store.useCurrentVisual(sessionId);
  const stageView = store.useStageView(sessionId);
  const sharedAnswer = store.useSharedAnswer(sessionId);
  const slidesUrl = store.useSlidesUrl(sessionId);
  const vote = store.useMyVote(sessionId, studentId);
  const { stream: remote, needRelay } = useReceiver(
    store,
    sessionId,
    studentId,
    session?.broadcasting ?? false,
    session?.liveEpoch ?? 0,
  );
  // No direct connection: ask for the relayed feed and keep asking while needed.
  useEffect(() => {
    if (!needRelay || !sessionId) return;
    const ask = () => void store.requestRelay({ sessionId }).catch(() => undefined);
    ask();
    const t = window.setInterval(ask, 10_000);
    return () => clearInterval(t);
    // store is rebuilt each render; the interval only needs the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needRelay, sessionId]);
  const relayFrame = useRelayFrame(store, sessionId, needRelay);
  const relayAudio = useRelayAudio(store, sessionId, needRelay);
  const [follow, setFollow] = useState(true);
  const [myHands, setMyHands] = useState(false);
  const myGestures = useGestures(myHands && !!session?.handMode);
  const [text, setText] = useState("");
  // Speaking a question fills the box (after anything already typed).
  const draftBase = useRef("");
  const dictation = useDictation((spoken) =>
    setText(((draftBase.current ? `${draftBase.current} ` : "") + spoken).slice(0, MAX_QUESTION)),
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session === undefined) return <StatusPage title="Joining class..." />;
  if (session === null) {
    return (
      <StatusPage
        title={`No class with code ${code}`}
        text="Check the code your professor gave you and try again."
        action={{ to: "/", label: "Enter another code" }}
      />
    );
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setError(null);
    setSending(true);
    try {
      await store.ask({ sessionId: session._id, studentId, text });
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function sendVote(value: FeedbackValue) {
    if (!session) return;
    try {
      await store.setFeedback({ sessionId: session._id, studentId, value });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const mode: "hands" | "molecule" | "slides" = session.handMode
    ? "hands"
    : session.stageMode === "molecule"
      ? "molecule"
      : "slides";
  const caption = visual ? (visual.groupId ? `${visual.label} in ${visual.query}` : visual.query) : null;
  const unmuteRelay = relayAudio.blocked && (
    <button className="unmute" onClick={relayAudio.unblock}>
      Click to hear your professor
    </button>
  );
  const professorCam = remote ? (
    <VideoView stream={remote} className="cover" />
  ) : relayFrame ? (
    <>
      <img className="relay-frame" src={relayFrame} alt="Your professor's camera" />
      <span className="relay-tag">Low-bandwidth</span>
      {unmuteRelay}
    </>
  ) : (
    <div className="stage-empty dark">
      <Icon name="video-off" size={18} />
      <span>{session.broadcasting ? "Connecting..." : "Camera off"}</span>
    </div>
  );

  return (
    <div className="room-page">
      <AppHeader wide>
        {session.broadcasting && (
          <span className="badge danger">
            <span className="live-dot on" /> LIVE
          </span>
        )}
        <span className="code-badge">{session.code}</span>
      </AppHeader>

      <main className="room">
        <div className="room-top">
          <h1>{session.topic}</h1>
          {session.transcribing && (
            <span className="muted small" title="Text only, no recording">
              Lecture is being transcribed so questions can be answered from it
            </span>
          )}
        </div>

        <div className="room-grid">
          <div className="stack">
            <section className="stage-panel card">
              <div className="stage-head">
                <span className="stage-title">
                  {mode === "hands"
                    ? `Your professor is holding ${caption ?? "a molecule"}`
                    : mode === "molecule"
                      ? (caption ?? "3D molecule")
                      : session.slideCount > 0
                        ? `Slide ${session.slideIndex + 1} of ${session.slideCount}`
                        : "Slides"}
                </span>
                <span className="spacer" />
                {mode === "molecule" && visual && (
                  <button
                    className={follow ? "chip active" : "chip"}
                    aria-pressed={follow}
                    onClick={() => setFollow(!follow)}
                    title={follow ? "Tap to explore on your own" : "Tap to follow your professor's view"}
                  >
                    {follow ? "Following professor" : "Follow professor"}
                  </button>
                )}
              </div>

              <div className={mode === "hands" ? "stage-frame dark" : "stage-frame"}>
                {mode === "slides" &&
                  (slidesUrl ? (
                    <SlideView url={slidesUrl} index={session.slideIndex} />
                  ) : (
                    <div className="stage-empty">
                      <div className="empty-icon">
                        <Icon name="slides" size={20} />
                      </div>
                      <strong>Waiting for slides</strong>
                      <span>Your professor's slides will appear here.</span>
                    </div>
                  ))}
                {mode === "molecule" &&
                  (visual ? (
                    <MoleculeView
                      sdf={visual.sdf}
                      highlight={visual.indices}
                      style={visual.style}
                      followView={follow ? stageView : null}
                    />
                  ) : (
                    <div className="stage-empty">
                      <div className="empty-icon">
                        <Icon name="cube" size={20} />
                      </div>
                      <strong>Waiting for a molecule</strong>
                    </div>
                  ))}
                {mode === "hands" && visual && (
                  // The professor's camera with the molecule drawn over it,
                  // turning as their hands turn it.
                  <MoleculeView
                    sdf={visual.sdf}
                    highlight={visual.indices}
                    style={visual.style}
                    followView={stageView}
                    backdrop={
                      remote ? (
                        <div className="backdrop is-live">
                          <VideoView stream={remote} mirrored className="backdrop__video" />
                          <div className="backdrop__shade" />
                        </div>
                      ) : relayFrame ? (
                        <div className="backdrop is-live">
                          <img className="backdrop__video" src={relayFrame} alt="" />
                          <div className="backdrop__shade" />
                          {unmuteRelay}
                        </div>
                      ) : undefined
                    }
                  />
                )}

              </div>
              {/* The molecule on this page, in 3D under the slide. */}
              {mode === "slides" && visual && (
                <div className="companion">
                  <div className="viewer-head">
                    <span className="caption">3D model: {caption}</span>
                    <button
                      className={follow ? "chip active" : "chip"}
                      aria-pressed={follow}
                      onClick={() => setFollow(!follow)}
                      title={follow ? "Tap to explore on your own" : "Tap to follow your professor's view"}
                    >
                      {follow ? "Following professor" : "Follow professor"}
                    </button>
                  </div>
                  <MoleculeView
                    sdf={visual.sdf}
                    highlight={visual.indices}
                    style={visual.style}
                    followView={follow ? stageView : null}
                  />
                </div>
              )}
            </section>

            <section className="card pulse-bar">
              <div>
                <h3>{session.slideCount > 0 ? `How's slide ${session.slideIndex + 1}?` : "How are you following?"}</h3>
                <p className="muted small">Your professor sees the class total, not your name.</p>
              </div>
              <div className="vote-buttons">
                <button
                  className={`confused ${vote === "confused" ? "active" : ""}`}
                  aria-pressed={vote === "confused"}
                  onClick={() => sendVote("confused")}
                >
                  I'm confused
                </button>
                <button
                  className={`understood ${vote === "understood" ? "active" : ""}`}
                  aria-pressed={vote === "understood"}
                  onClick={() => sendVote("understood")}
                >
                  I've got it
                </button>
              </div>
            </section>
          </div>

          <div className="room-side-col">
          {/* The professor's camera; in hand mode, the student's own molecule. */}
          <div className="side-tile">
            {mode === "hands" && visual ? (
              <MoleculeView
                sdf={visual.sdf}
                highlight={visual.indices}
                style={visual.style}
                controller={myGestures.controller}
                backdrop={myGestures.controller ? <WebcamBackdrop controller={myGestures.controller} /> : undefined}
              />
            ) : (
              professorCam
            )}
            <span className="pip-label">{mode === "hands" ? "Your copy: drag to turn it" : "Professor"}</span>
            {mode === "hands" && (
              <button
                className={myHands ? "pip-action sm" : "pip-action secondary sm"}
                onClick={() => setMyHands(!myHands)}
                title="Turn your own copy with your hands, in front of your camera"
              >
                <Icon name="hand" size={14} />
                {myHands ? "Hands on" : "Use my hands"}
              </button>
            )}
          </div>
          {mode === "hands" && myHands && myGestures.error && <p className="error">{myGestures.error}</p>}
          <aside className="card side-panel room-side">
            <div className="side-scroll student-side">
              {sharedAnswer && <SharedAnswerCard shared={sharedAnswer} />}
              <form onSubmit={ask} className="stack">
                <div>
                  <h2>Ask a question</h2>
                  <p className="muted small">
                    Type or speak it. Answered right away from your professor's lessons.
                  </p>
                </div>
                <label className="sr-only" htmlFor="question">
                  Your question
                </label>
                <textarea
                  id="question"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={MAX_QUESTION}
                  rows={3}
                  placeholder="e.g. Why is acetic acid acidic?"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && text.trim()) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                {error && <p className="error">{error}</p>}
                {dictation.error && <p className="error">{dictation.error}</p>}
                <div className="ask-foot">
                  {dictation.supported ? (
                    <button
                      type="button"
                      className={dictation.listening ? "sm speak-btn listening" : "secondary sm speak-btn"}
                      onClick={() => {
                        if (dictation.listening) {
                          dictation.stop();
                        } else {
                          draftBase.current = text.trim();
                          dictation.start();
                        }
                      }}
                      title="Ask with your voice"
                    >
                      <Icon name="mic" size={14} />
                      {dictation.listening ? "Listening... tap to stop" : "Speak"}
                    </button>
                  ) : (
                    <span className="muted small">
                      {text.length}/{MAX_QUESTION}
                    </span>
                  )}
                  <button type="submit" disabled={sending || dictation.listening || text.trim().length === 0}>
                    <Icon name="send" size={14} />
                    {sending ? "Sending..." : "Ask"}
                  </button>
                </div>
              </form>

              {mine && mine.length > 0 && (
                <div className="stack">
                  <h3 className="queue-heading">Your questions</h3>
                  {mine.map((q) => (
                    <article key={q._id} className="card my-q">
                      <p className="q-text">{q.text}</p>
                      {q.similarCount > 0 && (
                        <p className="muted small">
                          {q.similarCount === 1
                            ? "1 classmate asked something similar"
                            : `${q.similarCount} classmates asked something similar`}
                        </p>
                      )}
                      <AnswerCard answer={q.answer} />
                      {q.professorReply && (
                        <blockquote className="quote prof-reply">
                          {q.professorReply}
                          <cite>Your professor replied</cite>
                        </blockquote>
                      )}
                      <AskProfessor
                        question={q}
                        onSend={(note) =>
                          store.escalateQuestion({ sessionId: session._id, studentId, questionId: q._id, note })
                        }
                      />
                    </article>
                  ))}
                </div>
              )}
            </div>
          </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

// When the AI's answer didn't help, send the question on to the professor.
function AskProfessor({
  question,
  onSend,
}: {
  question: MyQuestion;
  onSend: (note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = question.answer?.status;
  if (question.professorReply) return null;
  if (question.escalated) {
    return (
      <span className="badge accent" style={{ alignSelf: "flex-start" }}>
        Sent to your professor
      </span>
    );
  }
  // Only once the AI has answered; unanswered questions already reach the professor.
  if (status !== "answered" && status !== "fallback") return null;
  if (!open) {
    return (
      <button className="ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        <Icon name="message" size={14} />
        Still unclear? Ask your professor
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
          await onSend(note);
          setOpen(false);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setSending(false);
        }
      }}
    >
      <textarea
        rows={2}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What's still unclear? (optional)"
        autoFocus
      />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="sm" disabled={sending}>
          <Icon name="send" size={14} />
          {sending ? "Sending..." : "Send to professor"}
        </button>
        <button type="button" className="ghost sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AnswerCard({ answer }: { answer: MyQuestion["answer"] }) {
  if (answer === null || answer.status === "pending") {
    return (
      <span className="thinking">
        <i />
        <i />
        <i />
        Looking in your lessons
      </span>
    );
  }
  if (answer.status === "not_covered") {
    return <p className="notice warn">Your lessons don't cover this yet. Your professor has been notified.</p>;
  }
  if (answer.status === "failed") {
    return <p className="notice warn">Couldn't answer right now. Your professor has been notified.</p>;
  }
  return (
    <div className="stack">
      {answer.text && <p>{answer.text}</p>}
      {answer.quotes.map((quote, i) => (
        <blockquote key={i} className="quote">
          {quote.text}
          <cite>
            <Icon name="shield" size={12} />
            Verified quote from {quote.label}
          </cite>
        </blockquote>
      ))}
    </div>
  );
}
