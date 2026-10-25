# Features

| Area | Status |
|---|---|
| Courses and sign-in | Passcode, per-course browser tokens, course list, past sessions |
| Lessons | Upload or paste, passage preview, edit (unchanged passages keep their embeddings), delete; up to 50,000 words |
| Automatic answers | Vector search plus Claude, quotes verified word for word, "not covered" flags, slow-Claude fallback, 20s cooldown and question caps |
| Lecture transcription | Chrome's speech recognition on the professor page, kept as editable lines; embedded in chunks and searched with the lessons (this session and earlier ones); the last two minutes are always included; the lesson wins when the lecture contradicts it, and the professor is flagged; students are told when transcription is on |
| Follow-up questions | Each answer is given the asking student's own earlier questions and answers in the session, plus the lecture topic and what is on the class screen, so "explain that again" and "why is this group acidic?" work. Follow-ups are also searched with their context, and are never grouped with other students' questions or answered from them |
| Similar questions | Questions that mean the same thing are grouped into one card with a distinct-student count and a short label; a near-identical question reuses the verified answer; students see "N classmates asked something similar" |
| Professor page | One page with a stage (join code, QR, shared molecule, votes) and a private queue of cards (escalated and not-covered first, then the most shared); Present mode |
| Student page | Join by code, follow the slides, watch the professor's camera, ask (typed or dictated by voice), vote, see answers with quotes, send an answer on to the professor |
| Slides | The professor uploads a PDF (pdf.js); everyone sees the same page, and the stage switches between slides and the 3D molecule |
| Live camera | The professor's camera and mic over WebRTC with Convex signalling; a low-rate relay through Convex for networks that block it; optional TURN |
| AI-read slides | Claude reads each slide (picture and text) and lists its compounds; the main one is shared automatically and shown in 3D, with the structure from the chemistry service |
| Per-slide votes | Confused/understood votes belong to the slide on screen, with a "where the class got lost" view for the professor |
| Escalation and replies | A student can send an AI-answered question on to the professor, who can reply to that student only |
| Chemistry service | PubChem lookup by name, or a 3D structure built from SMILES; RDKit detects 20 functional groups (alcohol, phenol, ether, aldehyde, ketone, acid, ester, anhydride, acyl halide, amide, three kinds of amine, nitrile, nitro, thiol, alkyl halide, alkene, alkyne, aromatic ring) |
| Hand gestures | A "Use hand gestures" toggle puts the professor's camera behind the molecule and lets the professor resize, rotate and move it by hand (open and close your hand, hold still and turn it, point). The professor's view is synced to students in real time, and students can turn their own copy with their hands. Mouse and touch still work, and the camera is optional. Lives in `packages/hand-gesture` (teammate's gesture lab: MediaPipe tracking, gesture recognition). The tests cover the logic, not real hands |
| Molecule stage | The professor loads any molecule, sees the groups found in it as chips, picks one to highlight and a display style, and shares it; the server re-verifies the highlight before students see it |
| Shared answers | The professor can put one student's question and the answer they were shown (anonymous) on every screen |

Overview and setup are in the main `README.md`. Design decisions and the data model are in `PROJECT_STRUCTURE.md`.
