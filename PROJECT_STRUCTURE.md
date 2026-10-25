# Project Structure

A live organic-chemistry classroom assistant. Students ask questions during a lecture and get an answer automatically, taken only from the professor's own material. The professor sees which questions the material could not answer and drives a shared 3D molecule.

## Decisions at a glance

| Area | Decision |
|---|---|
| Hub | Convex holds all shared state and runs the AI actions |
| Professor page | One page: a stage (join code, QR, shared molecule, vote counts) plus a private panel (question queue, molecule controls). "Present mode" hides the private panel so the page can be screen-shared. `/present/:code` redirects to it |
| Professor identity | One passcode creates or reclaims **courses**; each browser keeps a per-course token (only its hash is stored). Sessions, lessons and transcripts belong to a course |
| Answer source | The course's uploaded lessons and its lecture transcripts (this session's last two minutes, plus every earlier session in the course). Nothing else. If a lecture passage contradicts the lesson, the lesson is used, students see only lesson quotes, and the professor is flagged |
| Transcription | Chrome's speech recognition (audio goes to Google), kept running by the professor page even in Present mode; text only is stored; the professor can edit or delete lines (answers can quote them); students see a notice while it is on |
| Retrieval | Convex native vector index (`lessonChunks.by_embedding`, filtered by `courseId`). Embeddings: Voyage `voyage-4-lite`, 1024 dims. Keys made in MongoDB Atlas (`al-…`) use `ai.mongodb.com`; the client picks the endpoint from the key prefix |
| Answer generation | Claude (`claude-sonnet-5-5`, structured output, thinking off, low effort, 10s timeout) writes 2-3 sentences plus quotes. The server checks every quote appears word for word in the passage it names. A failed check means "not covered", never an unverified answer |
| Similar questions | Grouped per session by embedding similarity (>= 0.88, strict on purpose: a missed merge costs little, a false one hides a question); counted by distinct students; the professor can split a question out; a near-identical question (>= 0.97) reuses a verified answer. Thresholds come from a small sample and need tuning on real questions |
| Not covered | Student sees "Your lesson doesn't cover this. Your professor has been notified." The professor's queue pins these first, with the reason |
| Slow Claude | Student gets the closest passage verbatim, labelled |
| Limits | 20 questions per student per session, 20s cooldown, 300 questions per session |
| Privacy | Professor-only data (queue, reasons, timings) needs the course token. Students read only status, answer text and quotes for their own questions |
| Chemistry | FastAPI (`uv`, Python 3.12, PubChemPy, RDKit) is the only PubChem client and the only producer of atom indices |
| Stage | The professor's stage is local: load any molecule by name or SMILES (SMILES builds a 3D structure with RDKit when PubChem has none), pick from the groups RDKit detected, choose a style. "Share molecule" sends only the input; the server re-fetches and re-verifies the highlight, so indices never come from the browser. "Share answer" is separate. Students receive the molecule, highlight and style, not live rotation |
| Viewer | 3Dmol.js 2.5.5 behind our own `ViewerAdapter` (load SDF, highlight by atom index, style, reset). The teammate's gesture/camera viewer plugs in later |

## Repository layout

```
├── convex/
│   ├── schema.ts            # tables below
│   ├── courses.ts           # create / list (passcode) / claim / get
│   ├── sessions.ts          # create (course token), getByCode (public), listForCourse
│   ├── lessons.ts           # upload, edit (reuses unchanged embeddings), delete, list
│   ├── retrieval.ts         # vector search over a course's lesson and lecture passages
│   ├── transcript.ts        # live transcript lines, chunking, rebuild after edits, recent window
│   ├── grouping.ts          # similar-question groups, thresholds, group labels
│   ├── answers.ts           # the answer pipeline (internal action)
│   ├── questions.ts         # submit (limits, schedules the answer), queues
│   ├── feedback.ts          # confused/understood, counts, mine, reset
│   ├── visuals.ts           # load a molecule (professor stage), share it (server re-verifies), current
│   ├── sharing.ts           # share one answer with the class
│   ├── ai/answerPrompt.ts   # system prompt and JSON schema
│   └── lib/
│       ├── auth.ts          # requireCourseProfessor / requireProfessor
│       ├── chunk.ts         # lesson -> passages (shared with the upload preview)
│       ├── embed.ts         # Voyage client
│       ├── verify.ts        # word-for-word quote check
│       ├── quotes.ts        # validator for a quote and where it came from
│       ├── chem.ts          # chemistry service client
│       └── visual.ts        # shared validator for visuals
├── apps/web/                # React + TypeScript (Vite); vercel.json for SPA routing
│   └── src/
│       ├── views/           # Home, ProfessorStart, CoursePage, LessonForm, Professor,
│       │                    # Stage, StageControls, SharedAnswerCard, TranscriptPanel, Student
│       └── transcribe/      # Transcriber interface, Web Speech implementation, hook
├── services/chem/           # FastAPI: /molecule, /highlight (name or SMILES), /groups; 20 RDKit SMARTS groups
└── samples/functional-groups.md   # sample lesson for trying the system
```

## Tables

| Table | Visibility | Purpose |
|---|---|---|
| `courses` | token hashes private | name, browser-token hashes |
| `lessons`, `lessonChunks` | professor only | lesson text; passages with embeddings (vector index) |
| `sessions` | join code is public | code, topic, course |
| `questions` | professor all; student own | text, status |
| `answers` | student: status, text, quotes; professor: also reason and timings | one per question |
| `transcriptLines`, `transcriptChunks` | professor only | what the professor said (editable lines); embedded chunks of about 60-120 words, searched per course |
| `questionVectors`, `questionGroups` | professor/internal | question embeddings (vector index per session); groups of similar questions with a label |
| `feedback` | counts public; student reads own vote | confused / understood; professor can reset |
| `published_visuals` | public | the molecule shared with the class: SDF, RDKit-verified atom indices, display style |
| `sharedAnswers` | public | one anonymous question and answer shared with the class |

## Answer flow

```
Student submits -> question + pending answer saved, answer action scheduled
  1. embed the question once (Voyage, "query")
  1a. (lecture) the last two minutes of this session's transcript are added as an always-on passage
  1b. search this session's earlier questions: >= 0.88 similar -> same group (label written by
      Claude once two students share it); >= 0.97 and its answer is clean and every quote still exists in the lesson/transcript -> copy it
  2. vector search the course's passages; below score 0.25 -> not covered (no Claude call)
  3. Claude answers from the passages with exact quotes (retry once on a fast failure)
  4. verify every quote -> answered | not covered
  Claude slow -> closest passage verbatim (fallback); search fails -> failed (professor flagged)
Student sees the result live; professor sees flags first in the queue
```

## Status

Built and tested: the stage rework (any molecule by name or SMILES, 20 auto-detected groups, display styles, server-verified sharing, shareable answers), live lecture transcription (editable lines, chunk search across sessions, recent window, lesson-wins conflict handling), similar-question grouping (distinct-student counts, labels, split, group "mark answered", answer reuse, the students' classmates hint), courses and professor auth, lesson upload and editing with embeddings, retrieval, the answer pipeline with quote verification, limits, the merged professor page with Present mode and QR, student answers, the chemistry service, molecule preview and sharing, vote reset.

Planned next (in order): the stage rework (any molecule by name or SMILES, about 20 auto-detected functional groups, separate "share molecule" and "share answer"); session memory in prompts; the teammate's gesture viewer; hosting.

Dropped: the private copilot, concept cards, the understanding check, voice commands, and the Droid observability agent (Factory's service was unavailable). Answer timings are stored on each answer instead.

Known limits: deleting or editing a transcript line fixes future answers but does not retract answers students already saw; the "transcribing" notice can stay on if the professor's browser crashes; quote checks prove the quoted text exists in the lesson, not that the summary reads it correctly; students are identified by a random browser id; no per-IP rate limit; sessions never end; the chemistry service needs a tunnel to a local machine until it is hosted; heteroaromatic carbonyls (like caffeine's) and thioethers are not in the group library.

## Secrets

Convex environment variables only: `PROFESSOR_PASSCODE`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` (optionally `VOYAGE_BASE_URL`), `CHEM_SERVICE_URL`. Nothing in browser code or the repo.
