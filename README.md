# Spicy Doraemon

A live organic-chemistry classroom assistant. Students ask questions and vote "confused" or "understood" while the professor lectures. The professor asks a Claude copilot for a private suggestion, previews a molecular highlight that RDKit has verified, and publishes it to every student's screen.

The idea: an AI can help a professor teach in the moment, but it should never put an unchecked claim on the class screen. Claude proposes, code verifies, and the professor decides what students see.

## How it works

1. The professor starts a session and gets a 5-character join code.
2. Students join at `/s/<CODE>`, send questions, and vote confused or understood. The professor sees a live question queue and vote counts.
3. The professor clicks "Ask copilot" on a question. Claude answers from a fixed set of approved lesson excerpts and names a molecule and a functional group to show. The answer is private to the professor.
4. The chemistry service looks the molecule up on PubChem and uses RDKit to find the exact atoms of that functional group. If the group isn't in the molecule, no highlight is offered.
5. The professor previews the 3D molecule with the highlighted atoms, then clicks Publish. Students and the presentation view (`/present/<CODE>`) update live.

## What is available today

| Area | Status |
|---|---|
| Sessions | Professor passcode login, join codes, professor and student pages, presentation view |
| Student questions | Submit (up to 20 per student), live professor queue, mark answered |
| Understanding feedback | Confused / Understood votes, live counts, professor reset |
| Claude copilot | Private explanation, cited source excerpts and a teaching action; validated against the lesson; falls back to a labelled "cached" answer if Claude is slow or down |
| Chemistry service | PubChem lookup (demo molecules cached offline), RDKit functional-group matching for hydroxyl, carboxylic acid and ester |
| Molecule viewer | 3D view (rotate, zoom, reset) with highlighted atoms, driven only by the verified payload |
| Professor-controlled sharing | Private preview, explicit publish and unpublish; students never see previews or suggestions |
| Demo lesson | Ethanol, acetic acid and aspirin with five approved excerpts |

## Not built yet

- Concept cards from lecture transcript text, session memory (current molecule), and the understanding check
- QR code on the presentation view, voice input, and hand gestures
- Droid observability agent
- Stable hosting: the chemistry service currently needs a tunnel to your machine, and the frontend is not deployed
- Integration with the teammate's viewer and SpacetimeDB (waiting on their context)

Design decisions and the Convex tables are in `PROJECT_STRUCTURE.md`.

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
5. Open `/professor`, start a session, then join from another window at `/s/<CODE>`. The presentation view is `/present/<CODE>`.

Tests: `cd services/chem && uv run pytest`, and `npm run typecheck`.

## Safety model

Claude only proposes `{molecule, functional group, cited excerpt ids}` from a fixed lesson. The chemistry service (PubChem + RDKit SMARTS) is the only source of atom indices. If it cannot verify a highlight, nothing can be published. Private suggestions and previews live in tables only the professor token can read.

## Third-party code

3Dmol.js, RDKit, PubChemPy, Convex, React, FastAPI. No other code is reused.
