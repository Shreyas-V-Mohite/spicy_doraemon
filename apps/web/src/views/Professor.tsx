import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "../store/sessionStore";
import { errorMessage, getCourseToken } from "../lib/identity";
import type { LoadedMolecule, MoleculeStyle, Question, QueueCard } from "../types";
import { useTranscription } from "../transcribe/useTranscription";
import Stage, { type ShownMolecule } from "./Stage";
import StageControls, { type MoleculeInput } from "./StageControls";
import TranscriptPanel from "./TranscriptPanel";

const FLAGGED = new Set(["not_covered", "failed"]);

export default function Professor() {
  const { code = "" } = useParams();
  const store = useStore();
  const session = store.useSession(code);
  const token = session?.courseId ? getCourseToken(session.courseId) : null;
  const queue = store.useProfessorQueue(session?._id, token);
  const counts = store.useFeedbackCounts(session?._id);
  const visual = store.useCurrentVisual(session?._id);
  const sharedAnswer = store.useSharedAnswer(session?._id);
  // The professor's own stage: loaded locally, shared only on request.
  const [stage, setStage] = useState<{ input: MoleculeInput; mol: LoadedMolecule } | null>(null);
  const [input, setInput] = useState<MoleculeInput>({ kind: "name", value: "" });
  const [groupId, setGroupId] = useState<string | null>(null);
  const [style, setStyle] = useState<MoleculeStyle>("ball-and-stick");
  const [busy, setBusy] = useState<"load" | "share" | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const lines = store.useTranscriptLines(session?._id, token);
  const sessionId = session?._id;

  // Kept here, not in the panel, so transcribing continues in Present mode.
  const transcription = useTranscription({
    onFinal: (text) => {
      if (sessionId && token) {
        void store.addTranscriptLine({ sessionId, token, text });
      }
    },
    onActiveChange: (on) => {
      if (!sessionId || !token) return;
      void store.setTranscribing({ sessionId, token, on });
      // Pausing chunks whatever is left so it is searchable right away.
      if (!on) void store.flushTranscript({ sessionId, token });
    },
  });

  // Escape leaves Present mode.
  useEffect(() => {
    if (!present) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPresent(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [present]);

  if (session === undefined) return <main className="page">Loading…</main>;
  if (session === null) {
    return (
      <main className="page">
        <p>No session with code {code}.</p>
        <Link to="/professor">Start a new one</Link>
      </main>
    );
  }
  if (token === null) {
    return (
      <main className="page">
        <p>This browser isn't the professor for session {code}.</p>
        <Link to="/professor">Sign in as professor</Link>
      </main>
    );
  }

  // The server already puts cards that need the professor first.
  const open = queue?.filter((c) => c.open) ?? [];
  const done = queue?.filter((c) => !c.open) ?? [];

  async function markDone(card: QueueCard) {
    if (!session || !token) return;
    if (card.groupId) {
      await store.markGroupAnswered({
        sessionId: session._id,
        token,
        groupId: card.groupId,
      });
    } else {
      await store.markAnswered({
        sessionId: session._id,
        token,
        questionId: card.members[0]._id,
      });
    }
  }

  async function loadMolecule(next: MoleculeInput) {
    if (!session || !token) return;
    setInput(next);
    setBusy("load");
    setStageError(null);
    try {
      const mol = await store.loadMolecule({
        sessionId: session._id,
        token,
        kind: next.kind,
        value: next.value,
      });
      setStage({ input: { kind: next.kind, value: next.value.trim() }, mol });
      setGroupId(null);
    } catch (err) {
      setStageError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function shareMolecule() {
    if (!session || !token || !stage) return;
    setBusy("share");
    setStageError(null);
    try {
      await store.shareMolecule({
        sessionId: session._id,
        token,
        kind: stage.input.kind,
        value: stage.input.value,
        groupId: groupId ?? undefined,
        style,
      });
    } catch (err) {
      setStageError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const sharedCaption = visual
    ? visual.groupId
      ? `${visual.label} in ${visual.query}`
      : visual.query
    : null;
  const group = stage?.mol.groups.find((g) => g.id === groupId);
  const shown: ShownMolecule | null = stage
    ? {
        sdf: stage.mol.sdf,
        indices: group?.indices ?? [],
        style,
        caption: group ? `${group.label} in ${stage.mol.query}` : stage.mol.query,
      }
    : visual
      ? {
          sdf: visual.sdf,
          indices: visual.indices,
          style: visual.style,
          caption: sharedCaption ?? "",
        }
      : null;
  const shareState = !stage
    ? "nothing-loaded"
    : !visual
      ? "not-shared"
      : visual.query === stage.mol.query &&
          visual.groupId === groupId &&
          visual.style === style
        ? "shared"
        : "different";

  return (
    <main className={present ? "page present-mode" : "page"}>
      <header className="bar">
        <div>
          <h1>{session.topic}</h1>
          {!present && session.courseId && (
            <p className="muted">
              <Link to={`/professor/course/${session.courseId}`}>← Course</Link>
            </p>
          )}
        </div>
        <div className="counts">
          {transcription.status === "listening" && (
            <span className="live-dot on">Transcribing</span>
          )}
          {!present && (
            <button
              className="secondary"
              onClick={() => store.resetFeedback({ sessionId: session._id, token })}
            >
              Reset votes
            </button>
          )}
          <button
            className={present ? "secondary" : undefined}
            onClick={() => setPresent(!present)}
            title="Hides the private panels so this page can be screen-shared"
          >
            {present ? "Exit present mode" : "Present mode"}
          </button>
        </div>
      </header>

      <div className={present ? "present-grid" : "columns"}>
        <section>
          <Stage
            session={session}
            counts={counts}
            present={present}
            shown={shown}
            sharedAnswer={sharedAnswer}
            onStopSharingAnswer={
              present
                ? undefined
                : () => store.stopSharingAnswer({ sessionId: session._id, token })
            }
            controls={
              present ? undefined : (
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
                  shareState={shareState}
                  sharedCaption={sharedCaption}
                  sharing={busy === "share"}
                  onShare={shareMolecule}
                  onUnshare={() =>
                    store.unshareMolecule({ sessionId: session._id, token })
                  }
                  error={stageError}
                />
              )
            }
          />
        </section>

        {!present && (
          <section>
            <h2>Question queue ({open.length})</h2>
            {queue === undefined && <p className="muted">Loading…</p>}
            {queue && open.length === 0 && (
              <p className="muted">No open questions yet.</p>
            )}
            <ul className="list">
              {open.map((card) => (
                <li key={card.key} className={card.flagged ? "flagged" : undefined}>
                  <QuestionCard
                    card={card}
                    onDone={() => markDone(card)}
                    onShareAnswer={(questionId) =>
                      store.shareAnswer({ sessionId: session._id, token, questionId })
                    }
                    onSplit={(questionId) =>
                      store.splitFromGroup({
                        sessionId: session._id,
                        token,
                        questionId,
                      })
                    }
                  />
                </li>
              ))}
            </ul>
            {done.length > 0 && (
              <details>
                <summary>Answered ({done.length})</summary>
                <ul className="list">
                  {done.map((card) => (
                    <li key={card.key} className="muted">
                      {card.label ?? card.members[0].text}
                      {card.studentCount > 1 && ` · ${card.studentCount} students`}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <TranscriptPanel
              status={transcription.status}
              detail={transcription.detail}
              interim={transcription.interim}
              supported={transcription.supported}
              lines={lines}
              onStart={transcription.start}
              onPause={transcription.stop}
              onEdit={(lineId, text) =>
                store.editTranscriptLine({ sessionId: session._id, token, lineId, text })
              }
              onDelete={(lineId) =>
                store.deleteTranscriptLine({ sessionId: session._id, token, lineId })
              }
              onClear={() => store.clearTranscript({ sessionId: session._id, token })}
            />
          </section>
        )}
      </div>
    </main>
  );
}

function QuestionCard({
  card,
  onDone,
  onSplit,
  onShareAnswer,
}: {
  card: QueueCard;
  onDone: () => void;
  onSplit: (questionId: string) => void;
  onShareAnswer: (questionId: string) => Promise<void>;
}) {
  const grouped = card.members.length > 1;
  const openMembers = card.members.filter((m) => m.status === "open");
  // Show the answer that needs attention, else the original (oldest) one.
  const rep =
    openMembers.find((m) => FLAGGED.has(m.answerStatus ?? "")) ??
    card.members[card.members.length - 1];
  // Only an answer the student actually saw can be shared with the class.
  const shareable = [rep, ...card.members].find(
    (m) => m.answerStatus === "answered" || m.answerStatus === "fallback",
  );
  return (
    <>
      <p>
        <strong>{card.label ?? rep.text}</strong>{" "}
        {card.studentCount > 1 && (
          <span className="pill confused">{card.studentCount} students</span>
        )}
      </p>
      <AnswerLine question={rep} />
      {grouped && (
        <details>
          <summary className="muted">All {card.members.length} questions</summary>
          <ul className="list">
            {card.members.map((m) => (
              <li key={m._id}>
                <p>{m.text}</p>
                <button
                  className="secondary"
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
          <button onClick={() => void onShareAnswer(shareable._id)}>
            Share answer with class
          </button>
        )}
        <button className="secondary" onClick={onDone}>
          {grouped ? "Mark all answered" : "Mark answered"}
        </button>
      </div>
    </>
  );
}

function AnswerLine({ question }: { question: Question }) {
  const status = question.answerStatus;
  if (status === null || status === "pending") {
    return <p className="muted">Looking in the lesson…</p>;
  }
  if (FLAGGED.has(status)) {
    return (
      <p className="error">
        {status === "failed" ? "Couldn't answer" : "Not covered by your lesson"}
        {question.answerNote ? ` (${question.answerNote})` : ""}. The student was
        told you've been notified.
      </p>
    );
  }
  return (
    <details open={question.answerConflict}>
      <summary className="muted">
        {status === "fallback" ? "Closest passage shown" : "Answered from your material"}
      </summary>
      {question.answerConflict && <p className="error">{question.answerNote}</p>}
      <p>{question.answerText}</p>
    </details>
  );
}
