# Project Structure

Live organic-chemistry classroom assistant. Students ask questions and give confusion feedback. The professor gets a private Claude suggestion. The professor publishes a verified molecular highlight that every student sees live.

First milestone: student asks → professor gets a private Claude suggestion → professor publishes a molecular highlight → students see it live.

## Decisions at a glance

| Area | Decision |
|---|---|
| Hub | Convex holds all shared state and runs the AI actions |
| Chemistry | FastAPI (`uv`, Python 3.12, PubChemPy, RDKit) is the only PubChem client and the only producer of atom indices |
| Safety | Claude proposes `{molecule, group_id, source_ids}`. RDKit SMARTS produces the indices. Unverified means publish is disabled |
| Privacy | Professor-only and public data live in separate tables. Students and the presentation view can only call public queries |
| Auth | One professor passcode, checked in a mutation, plus a random token in `localStorage`. Students join with a code and no account |
| Copilot trigger | Professor clicks "Ask copilot". Nothing runs or publishes automatically |
| Claude call | One structured-output call (JSON schema; Sonnet 5.5 rejects forced tool use), `claude-sonnet-5-5`, thinking off (`between_tools`), effort `low`, `max_tokens` 400, 10s timeout (`CLAUDE_TIMEOUT_MS` in `convex/copilot.ts`). Retry once only on a fast error. A timeout goes straight to a cached suggestion (labelled "cached", with the reason in `note`); questions no canned answer fits get a generic no-highlight suggestion |
| Viewer | 3Dmol.js 2.5.5 behind our own `ViewerAdapter`. It loads only the SDF payload FastAPI returns, with `keepH` and highlights selected by `serial` (= SDF atom position = RDKit index). The teammate's `MoleculeViewer` can replace it later (on hold) |
| Voice | Professor console only. Web Speech API → name → FastAPI resolve → private preview → explicit publish |
| Observability | Every pipeline step writes a row to `traces`. A separate Node script using `@factory/droid-sdk` analyses traces and writes `trace_insights`. Dev-only tab, off the critical path |
| Database portability | A `sessionStore` interface wraps all shared-state access. Convex implements it. SpacetimeDB is on hold |
| Hosting | Frontend on Vercel (students join from phones by code or QR). Convex hosted. FastAPI behind a tunnel for now, URL stored as a Convex env var |
| Lesson | Ethanol (hydroxyl), acetic acid (carboxyl), aspirin (carboxyl + ester). Three groups, about five excerpts with IDs. Demo question: "why is acetic acid acidic?" |
| Reuse | No code reused: the original `index.html` Three.js viewer and `TA-da-main.zip` were not ported. Libraries only (3Dmol.js, RDKit, PubChemPy, Convex, React) |

## Repository layout

```
spicy_doraemon/
├── PROJECT_STRUCTURE.md
├── README.md                    # setup, demo script, reused-code credits
├── .env.example                 # names only, never values
├── .gitignore                   # includes .env*, .venv, node_modules
│
├── convex/                      # backend hub (TypeScript)
│   ├── schema.ts                # tables below
│   ├── sessions.ts              # create (passcode) / getByCode (public)
│   ├── questions.ts             # submit (capped), listMine, professor queue, markAnswered
│   ├── feedback.ts              # confused/understood, counts, mine, reset
│   ├── copilot.ts               # Claude call, validation, fallback, suggestions
│   ├── visuals.ts               # buildPreview, publish, unpublish, current
│   ├── ai/prompts.ts            # copilot system prompt and JSON schema
│   ├── lib/
│   │   ├── auth.ts              # requireProfessor(token)
│   │   ├── chem.ts              # chemistry service client and response checks
│   │   ├── lesson.ts            # excerpts, molecules, groups, cached fallbacks
│   │   └── visual.ts            # shared validator for previews / published visuals
│   └── _generated/              # do not edit
│
├── apps/web/                    # React + TypeScript (Vite), vercel.json for SPA routing
│   └── src/
│       ├── views/               # Home, ProfessorStart, Professor (queue, copilot cards),
│       │                        # VisualPanel (preview/publish), Student, Presentation
│       ├── store/               # sessionStore interface + convexStore implementation
│       ├── viewer/              # ViewerAdapter, ThreeDmolAdapter, MoleculeView
│       ├── lesson.ts            # demo molecules and group labels
│       └── ErrorBoundary.tsx
│
├── services/chem/               # FastAPI (uv, Python 3.12)
│   ├── pyproject.toml
│   └── app/
│       ├── main.py              # /molecule, /resolve, /highlight, /health
│       ├── pubchem.py           # PubChemPy lookup, caching
│       ├── groups.py            # functional-group SMARTS table (3 groups)
│       └── tests/               # indices match SDF order for each demo molecule
│
├── observability/               # NOT BUILT YET: Droid agent over a traces table
│
├── (no lesson/ dir)             # lesson data lives in convex/lib/lesson.ts
│
└── docs/
    ├── architecture.md          # diagram and data flow
    └── demo-script.md           # 3-minute scripted walkthrough
```

## Convex tables

| Table | Visibility | Purpose |
|---|---|---|
| `sessions` | public (join code only) | code, topic, professor token hash (current molecule and context memory NOT BUILT YET) |
| `questions` | professor reads all; students see their own | text, session, status; capped at 20 per student per session |
| `feedback` | aggregate counts public; a student reads only their own vote | confused / understood per student; professor can reset |
| `suggestions` | professor only | Claude output, source IDs, optional molecule/group, `previewId` only if verified, `note`, `cached` flag |
| `previews` | professor only | molecule SDF plus RDKit-verified highlight indices, not yet public |
| `published_visuals` | public | the published payload and verified indices |
| `cards` | draft: professor only; published: public | NOT BUILT YET (concept cards) |
| `traces`, `trace_insights` | professor/dev only | NOT BUILT YET (observability) |

## Data flow for the first milestone

```
Student → questions.submit (Convex)
Professor clicks "Ask copilot"
  → ai/copilot action
      1. Claude (3s timeout, forced JSON) → {molecule, group_id, source_ids, explanation, action}
      2. reject unknown group_id or source_ids not in excerpts.json
      3. FastAPI /highlight → {sdf, atoms, bonds, indices} (SMARTS)
      4. write suggestions + previews (professor only)
      5. write a trace row at every step
  on failure: cached suggestion, labelled "cached"
Professor previews, then clicks Publish (disabled if unverified)
  → visuals.publish → published_visuals (public)
Students and the presentation view update reactively
```

## Build order

1. Sessions and the three screens.
2. Questions and confusion feedback.
3. One molecule loaded and a validated highlight published (FastAPI + viewer).
4. Claude integration.
5. Concept cards and session context.
6. Gestures, failure handling, observability, rehearsal.

Cut order if time runs short: understanding check, session memory, concept timeline, gestures, Droid agent.

## On hold (awaiting context from the user)

- SpacetimeDB and the teammate's other workflow (only `sessionStore` is prepared for it).
- The teammate's `MoleculeViewer`, `MoleculeViewerAdapter`, `GestureCommand` contracts, and a highlight command on their adapter.
- A `droid` CLI install and a `FACTORY_API_KEY` (needed by step 6).

## Secrets

API keys live only in Convex env vars and `.env` files that are git-ignored: `ANTHROPIC_API_KEY`, `CHEM_SERVICE_URL`, `PROFESSOR_PASSCODE`, `FACTORY_API_KEY`. Nothing in browser code.

## Status

Built and verified: sessions and the three views, questions and feedback (with reset), the chemistry service, private previews and explicit publish, the 3Dmol viewer, the Claude copilot with validation and fallbacks, and the privacy split (every professor read or write requires the token).

Not built: concept cards, session memory (current molecule), understanding check, QR code, voice input, gestures, the Droid observability agent, a stable chemistry-service host (the Cloudflare quick tunnel URL changes on every restart), and frontend hosting.

Known limits: students are identified by a random browser id (a capability, not authentication); there is no per-IP rate limit; sessions never end.
