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
| Claude call | One call with forced tool-use JSON, `claude-sonnet-5-5`, `max_tokens` about 300, 3s timeout. Retry once only on a fast error. Timeout goes straight to the cached suggestion (labelled "cached") |
| Viewer | 3Dmol.js 2.5.5 behind our own `ViewerAdapter`. It loads only the SDF payload FastAPI returns. The teammate's `MoleculeViewer` can replace it later (on hold) |
| Voice | Professor console only. Web Speech API → name → FastAPI resolve → private preview → explicit publish |
| Observability | Every pipeline step writes a row to `traces`. A separate Node script using `@factory/droid-sdk` analyses traces and writes `trace_insights`. Dev-only tab, off the critical path |
| Database portability | A `sessionStore` interface wraps all shared-state access. Convex implements it. SpacetimeDB is on hold |
| Hosting | Frontend on Vercel (students join from phones by code or QR). Convex hosted. FastAPI behind a tunnel for now, URL stored as a Convex env var |
| Lesson | Ethanol (hydroxyl), acetic acid (carboxyl), aspirin (carboxyl + ester). Three groups, about five excerpts with IDs. Demo question: "why is acetic acid acidic?" |
| Reuse | Only the original `index.html` viewer, credited in the README. Nothing from `TA-da-main.zip` |

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
│   ├── sessions.ts              # create/join session, professor auth, context
│   ├── questions.ts             # submit, list (professor queue), group
│   ├── feedback.ts              # confused/understood + aggregate counts
│   ├── suggestions.ts           # professor-only suggestions
│   ├── visuals.ts               # preview and publish; public published_visuals
│   ├── cards.ts                 # concept cards: draft → published
│   ├── traces.ts                # trace writes, insights reads
│   ├── ai/
│   │   ├── copilot.ts           # action: Claude call → validate → FastAPI → save
│   │   ├── cards.ts             # action: transcript chunk → draft cards
│   │   ├── prompts.ts           # fixed prompts and JSON schemas
│   │   └── fallback.ts          # cached suggestion for the rehearsed question
│   ├── lib/
│   │   ├── auth.ts              # requireProfessor(token)
│   │   └── chem.ts              # FastAPI client (URL from env)
│   └── _generated/              # do not edit
│
├── apps/web/                    # React + TypeScript (Vite)
│   └── src/
│       ├── main.tsx
│       ├── views/
│       │   ├── Professor.tsx    # queue, copilot, preview/publish, cards, voice
│       │   ├── Student.tsx      # join, ask, confused/understood, see published
│       │   ├── Presentation.tsx # public visual, QR code, optional gestures
│       │   └── Insights.tsx     # dev-only observability tab
│       ├── store/
│       │   ├── sessionStore.ts  # interface (subscribe, ask, publish, ...)
│       │   └── convexStore.ts   # Convex implementation
│       ├── viewer/
│       │   ├── ViewerAdapter.ts # load(sdf) highlight(indices) clear() reset()
│       │   ├── Viewer3Dmol.tsx  # 3Dmol.js implementation
│       │   └── gestures.ts      # optional MediaPipe module, behind a toggle
│       ├── voice/useVoice.ts    # Web Speech API
│       └── types/               # MolPayload, Highlight, Suggestion
│
├── services/chem/               # FastAPI (uv, Python 3.12)
│   ├── pyproject.toml
│   └── app/
│       ├── main.py              # /molecule, /resolve, /highlight, /health
│       ├── pubchem.py           # PubChemPy lookup, caching
│       ├── groups.py            # functional-group SMARTS table (3 groups)
│       └── tests/               # indices match SDF order for each demo molecule
│
├── observability/               # Droid agent (Node, separate process)
│   ├── package.json             # @factory/droid-sdk
│   └── src/watch.ts             # read traces → droid run() → write insights
│
├── lesson/
│   ├── molecules.json           # ethanol, acetic acid, aspirin
│   └── excerpts.json            # approved source excerpts with IDs
│
└── docs/
    ├── architecture.md          # diagram and data flow
    └── demo-script.md           # 3-minute scripted walkthrough
```

## Convex tables

| Table | Visibility | Purpose |
|---|---|---|
| `sessions` | public (join code only) | code, topic, current molecule, `context` (last 5 questions), professor token hash |
| `questions` | professor reads all; students see their own | text, session, status, group |
| `feedback` | aggregate counts public | confused / understood per student |
| `suggestions` | professor only | Claude output, source IDs, verification status, `cached` flag |
| `previews` | professor only | molecule payload plus proposed highlight, not yet public |
| `published_visuals` | public | the published payload and verified indices |
| `cards` | draft: professor only; published: public | concept cards |
| `traces` | professor/dev only | step, latency, status, error |
| `trace_insights` | professor/dev only | Droid's findings |

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
