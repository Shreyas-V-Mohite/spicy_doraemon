#!/usr/bin/env bash
# Starts a Cloudflare quick tunnel to the chemistry service running on this
# machine and points Convex at it, so you never copy the changing address by
# hand. Keep it running while you demo. Ctrl-C stops the tunnel.
#
#   npm run tunnel            (the chemistry service must already be running)
set -euo pipefail

PORT="${CHEM_PORT:-8000}"
cd "$(dirname "$0")/.."

if ! curl -sf -m 3 "http://localhost:${PORT}/health" >/dev/null; then
  echo "The chemistry service isn't answering on port ${PORT}."
  echo "Start it first:  cd services/chem && uv run uvicorn app.main:app --port ${PORT}"
  exit 1
fi

LOG="$(mktemp -t spicy-tunnel)"
cloudflared tunnel --url "http://localhost:${PORT}" >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT

URL=""
for _ in $(seq 1 45); do
  URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "No tunnel address was issued (Cloudflare rate-limits quick tunnels; wait a minute and retry)."
  echo "cloudflared said:"; tail -3 "$LOG"
  exit 1
fi

# Check the way Convex will reach it. A brand-new tunnel name can take a while
# to resolve through this machine's DNS even though it already works for the
# rest of the internet, so ask Cloudflare's resolver and connect to that address.
HOST="${URL#https://}"
reachable() {
  local ip
  ip="$(dig +short @1.1.1.1 "$HOST" 2>/dev/null | grep -E '^[0-9.]+$' | head -1 || true)"
  if [ -n "$ip" ]; then
    curl -sf -m 5 --resolve "${HOST}:443:${ip}" "${URL}/health" >/dev/null
  else
    curl -sf -m 5 "${URL}/health" >/dev/null
  fi
}
echo "Tunnel address ${URL}; waiting for it to start routing..."
for _ in $(seq 1 60); do
  reachable && break
  sleep 1
done
reachable || { echo "Tunnel ${URL} never became reachable."; exit 1; }

npx convex env set CHEM_SERVICE_URL "$URL" >/dev/null
echo "Convex now uses ${URL} -> localhost:${PORT}. Leave this running; Ctrl-C to stop."
wait "$TUNNEL_PID"
