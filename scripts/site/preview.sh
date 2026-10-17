#!/usr/bin/env bash
# Build examples/site (base /native-surface/) and serve dist with vite preview.
# Heavy build is flocked. Preview itself is a long-running server — not flocked.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SITE_DIR="$ROOT/examples/site"
PORT="${PORT:-4870}"
BASE="${BASE:-/native-surface/}"
# Orchestrator work/ dir (git-excluded) at the repo root; WORK_DIR / HEAVY_LOCK override.
WORK_DIR="${WORK_DIR:-$ROOT/work}"
LOCK="${HEAVY_LOCK:-$WORK_DIR/.heavy.lock}"
FILTER="${SITE_FILTER:-site}"

if [[ ! -f "$SITE_DIR/package.json" ]]; then
  echo "preview.sh: examples/site is not in this checkout yet." >&2
  echo >&2
  echo "The 'site' package has not been created. After the site/shell lane lands:" >&2
  echo "  PORT=${PORT} $0" >&2
  echo >&2
  echo "Until then, build another example and pass its URL to shoot.mjs / record-hero.mjs:" >&2
  echo "  flock $LOCK pnpm --filter embed-demo build" >&2
  echo "  pnpm --filter embed-demo exec vite preview --host 0.0.0.0 --port 4881 --strictPort" >&2
  echo "  node scripts/site/shoot.mjs http://localhost:4881/ /path/to/shots" >&2
  echo >&2
  echo "Expected: $SITE_DIR/package.json (pnpm --filter $FILTER)" >&2
  exit 1
fi

if ! command -v flock >/dev/null 2>&1; then
  echo "preview.sh: flock is required to serialize heavy builds." >&2
  exit 1
fi

mkdir -p "$(dirname "$LOCK")"

if [[ "${SKIP_BUILD:-}" == "1" ]]; then
  echo "preview.sh: SKIP_BUILD=1 — using existing dist"
else
  echo "preview.sh: building $FILTER (base=$BASE) under flock $LOCK"
  flock "$LOCK" pnpm --filter "$FILTER" exec vite build --base="$BASE"
fi

echo "preview.sh: http://0.0.0.0:${PORT}${BASE}"
cd "$SITE_DIR"
exec pnpm exec vite preview --host 0.0.0.0 --port "$PORT" --strictPort --base "$BASE"
