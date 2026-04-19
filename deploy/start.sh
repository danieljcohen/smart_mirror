#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

OLD=$(git rev-parse HEAD)
git pull --ff-only
NEW=$(git rev-parse HEAD)

if [ "$OLD" != "$NEW" ] || [ ! -d mirror_frontend/dist ]; then
  (cd backend && uv sync)
  (cd mirror_frontend && yarn install && yarn build)
fi

(cd backend && uv run app.py) &
(cd mirror_frontend && yarn preview --host --port 5173) &

until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done

exec chromium-browser --kiosk --noerrdialogs --disable-infobars http://localhost:5173
