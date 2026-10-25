# Spicy Doraemon

A live organic-chemistry classroom assistant. Students ask questions and vote "confused" or "understood". The professor asks a Claude copilot for a private suggestion, previews an RDKit-verified molecular highlight, and publishes it to every student's screen.

See `PROJECT_STRUCTURE.md` for the design decisions, tables and status.

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
