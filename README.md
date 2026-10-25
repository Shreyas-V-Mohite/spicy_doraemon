# Spicy Doraemon

A live organic-chemistry classroom assistant. Students ask questions and vote "confused" or "understood" while the professor lectures. Each student gets an answer automatically, taken only from the professor's own lessons and lecture transcript, with quotes that the server has checked word for word. The professor sees what the material couldn't answer, and can put a verified, highlighted 3D molecule or a good answer on every student's screen.

The idea: an AI can help a professor teach in the moment, but it should never put an unchecked claim in front of students. Claude proposes, code verifies, and the professor decides what the whole class sees.

## How it works

1. A professor creates a **course** and uploads its lessons (paste text or a `.md`/`.txt` file). Each lesson is split into passages and embedded for search.
2. The professor starts a session and gets a join code and a QR code. Students join at `/s/<CODE>`.
3. A student asks a question. The system finds the matching passages in the course's lessons and lecture transcripts (including the last two minutes of the live lecture), and Claude writes a 2-3 sentence answer with quotes. The server checks that every quote appears word for word in the lesson. The student sees the answer and the quotes, labelled with where they came from.
4. If the lesson doesn't cover the question, the student is told so and the professor sees it flagged at the top of the queue.
5. The professor page also shows confused/understood votes. The professor can load any molecule by name or SMILES, highlight one of the functional groups RDKit finds in it, and share it, or share a good answer, with the whole class. "Present mode" hides the private panel so the page can be screen-shared.

## What is available today

| Area | Status |
|---|---|
| Courses and sign-in | Passcode, per-course browser tokens, course list, past sessions |
| Lessons | Upload or paste, passage preview, edit (unchanged passages keep their embeddings), delete; up to 50,000 words |
| Automatic answers | Vector search plus Claude, quotes verified word for word, "not covered" flags, slow-Claude fallback, 20s cooldown and question caps |
| Lecture transcription | Chrome's speech recognition on the professor page, kept as editable lines; embedded in chunks and searched with the lessons (this session and earlier ones); the last two minutes are always included; the lesson wins when the lecture contradicts it, and the professor is flagged; students are told when transcription is on |
| Follow-up questions | Each answer is given the asking student's own earlier questions and answers in the session, plus the lecture topic and what is on the class screen, so "explain that again" and "why is this group acidic?" work. Follow-ups are also searched with their context, and are never grouped with other students' questions or answered from them |
| Similar questions | Questions that mean the same thing are grouped into one card with a distinct-student count and a short label; a near-identical question reuses the verified answer; students see "N classmates asked something similar" |
| Professor page | One page with a stage (join code, QR, shared molecule, votes) and a private queue of cards (not-covered first, then the most shared); Present mode |
| Student page | Join by code, ask, vote, see answers with quotes |
| Chemistry service | PubChem lookup by name, or a 3D structure built from SMILES; RDKit detects 20 functional groups (alcohol, phenol, ether, aldehyde, ketone, acid, ester, anhydride, acyl halide, amide, three kinds of amine, nitrile, nitro, thiol, alkyl halide, alkene, alkyne, aromatic ring) |
| Hand gestures | A "Use hand gestures" toggle puts the professor's camera behind the molecule and lets the professor resize, rotate and move it by hand (open and close your hand, hold still and turn it, point). The camera view is meant to be screen-shared; students only get the shared molecule. Mouse and touch still work, and the camera is optional. Lives in `packages/hand-gesture` (teammate's gesture lab: MediaPipe tracking, gesture recognition). The tests cover the logic, not real hands |
| Molecule stage | The professor loads any molecule, sees the groups found in it as chips, picks one to highlight and a display style, and shares it; the server re-verifies the highlight before students see it |
| Shared answers | The professor can put one student's question and the answer they were shown (anonymous) on every screen |

## Not built yet

- Stable hosting: the chemistry service needs a tunnel to your machine, and the frontend is not deployed

Design decisions and the data model are in `PROJECT_STRUCTURE.md`.

## Run it locally

You need Node 20+, `uv`, and `cloudflared` (or another tunnel).

1. Install and start Convex (first run asks you to log in):
   ```
   npm install
   npx convex dev
   ```
2. Set the Convex environment variables (never commit these):
   ```
   npx convex env set PROFESSOR_PASSCODE <passcode>
   npx convex env set ANTHROPIC_API_KEY <key>
   npx convex env set VOYAGE_API_KEY <key>   # embeddings; Atlas-issued (al-) keys work too
   npx convex env set CHEM_SERVICE_URL <public url of the chemistry service>
   ```
3. Start the chemistry service and a tunnel so Convex (in the cloud) can reach it:
   ```
   cd services/chem && uv sync && uv run uvicorn app.main:app --port 8000
   cloudflared tunnel --url http://localhost:8000
   ```
   Quick-tunnel URLs change on every restart; set `CHEM_SERVICE_URL` again each time.
4. Create `apps/web/.env.local` with `VITE_CONVEX_URL=<your Convex deployment URL>` and start the frontend:
   ```
   npm run dev -w web
   ```
5. Open `/professor`, enter the passcode, create a course, add the sample lesson from `samples/functional-groups.md`, and start a session. Join from another window at `/s/<CODE>` and ask "Why is acetic acid acidic?".

For hand gestures, fetch MediaPipe's model once with `npm run models -w @spicy/hand-gesture` (about 8 MB download; the camera needs localhost or HTTPS).

Tests: `cd services/chem && uv run pytest`, `npm test -w @spicy/hand-gesture`, and `npm run typecheck`.

## Safety model

Answers come only from the professor's lessons, and every quote is checked word for word before a student sees it. If the check fails or the lesson doesn't cover the question, the student is told so instead of being shown an unverified answer. The chemistry service (PubChem + RDKit SMARTS) is the only source of atom indices, and nothing unverified can be published. Professor-only data lives behind the course token.

## Third-party code

3Dmol.js, RDKit, PubChemPy, Voyage AI embeddings, Convex, React, FastAPI, qrcode.react, MediaPipe Hand Landmarker. The hand-tracking and gesture code in `packages/hand-gesture` is from the team's Molecule Gesture Lab. No other code is reused.
