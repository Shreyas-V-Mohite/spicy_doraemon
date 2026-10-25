# Deploying

Three things run somewhere: **Convex** (the backend, already hosted), the **chemistry service** (Python), and the **web app** (static files). Students open the web app from their phones, so the web app must be on a public HTTPS address. HTTPS also lets the professor's browser use the camera.

| Piece | Where | Needs |
|---|---|---|
| Convex backend | Convex (hosted) | a deployment and its environment variables |
| Chemistry service | Render (a Blueprint is in `render.yaml`) or any Docker host | a host account |
| Web app | Vercel (settings are in `vercel.json`) | a Vercel account and the Convex address |

For a local rehearsal none of this is needed: `npm run tunnel` publishes the chemistry service from your laptop (see the end of this file).

## 1. Chemistry service

The `services/chem/Dockerfile` builds a self-contained image (RDKit, PubChemPy, and the three demo molecules cached so they work offline). It has been built and run locally: open health check, key-protected endpoints, SMILES to 3D, live PubChem lookups, non-root user.

**On Render**

1. In Render, choose **New > Blueprint** and connect the GitHub repository. It reads `render.yaml` and creates the `spicy-chem` web service.
2. Render generates a value for `CHEM_API_KEY`. Copy it from the service's *Environment* tab.
3. When the deploy is live, tell Convex where it is and give it the key:
   ```
   npx convex env set CHEM_SERVICE_URL https://<your-service>.onrender.com
   npx convex env set CHEM_API_KEY <the value from Render>
   ```
4. Run `npm run preflight`. It should show the service answering `/health` and `/groups` with the key.

**Cold starts.** Render's free instances sleep when idle and take about a minute to wake. A question sent to a sleeping service waits (Convex gives the chemistry service 12 seconds, then reports it unreachable). Use a paid instance for a real class, or open `/health` in a browser a few minutes before a demo.

**On Fly, Railway or another host.** Point it at `services/chem/Dockerfile`; it listens on `$PORT`. Set `CHEM_API_KEY` as a secret on the host and in Convex, as above.

The key protects `/groups`, `/molecule` and `/highlight`. `/health` stays open so the host's health check works. With no key set the service is open, which is fine on a laptop and not on the internet.

## 2. Convex

You can demo from the **dev deployment** (what `npx convex dev` uses). That is the simplest: nothing to deploy, and its data and environment variables are already set. A **production deployment** is separate (its own data and environment variables) and is what to use if the app will stay up after the event:

```
npx convex deploy                      # pushes the functions to production
npx convex env set --prod PROFESSOR_PASSCODE <passcode>
npx convex env set --prod ANTHROPIC_API_KEY <key>
npx convex env set --prod VOYAGE_API_KEY <key>
npx convex env set --prod CHEM_SERVICE_URL https://<your-service>.onrender.com
npx convex env set --prod CHEM_API_KEY <key>
```

Production starts empty, so upload the lesson again (or run the seed script against it). Pick a new `PROFESSOR_PASSCODE`: the development one has been shown in chat and logs.

## 3. Web app on Vercel

1. In Vercel, **Add New > Project**, import the repository, and leave the **Root Directory** at the repository root. `vercel.json` supplies the install command, the build command (which also downloads MediaPipe's hand model, about 8 MB), the output folder and the single-page-app rewrite, so deep links like `/s/ABCDE` work.
2. Add an environment variable **`VITE_CONVEX_URL`** with the address of the Convex deployment you chose (it is in `.env.local` as `CONVEX_URL` for development, and in the Convex dashboard for production).
3. Deploy. Open `https://<your-project>.vercel.app/professor`, sign in with the passcode, and the QR code on the stage now points at that address, so phones can scan it.

Redeploy after changing the Convex address. Other environment variables never go to the browser.

## Order of operations

1. Chemistry service up, with its key.
2. Convex environment variables set (`npm run preflight` checks them).
3. Web app deployed with `VITE_CONVEX_URL`.
4. `npm run demo:seed` (against the same Convex deployment) to create the demo course and lesson.
5. Open the web app on your laptop and a phone, run through `docs/demo-script.md`.

## Local rehearsal (no accounts)

```
cd services/chem && uv run uvicorn app.main:app --port 8000   # terminal 1
npm run tunnel                                                # terminal 2: publishes it and updates Convex
npm run dev -w web                                            # terminal 3
npm run preflight                                             # checks everything
```

`npm run tunnel` uses a free Cloudflare quick tunnel. Its address changes every time and it can take up to a minute to start routing, and Cloudflare sometimes rate-limits new tunnels. It is fine for rehearsing and a poor choice for a demo you depend on: host the service instead.

Phones can't use `localhost`. For a local rehearsal on the same Wi-Fi, open the web app by your computer's address (`npm run dev -w web -- --host`), or deploy it.
