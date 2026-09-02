#!/usr/bin/env bash
# Publish packages/* to npm (topo order via pnpm -r:
# compat → native-surface → design-plane → playground).
#
#   bash publish.sh            # dry run
#   bash publish.sh --push     # actually publish
set -euo pipefail
cd "$(dirname "$0")"

extra=(--dry-run)
if [ "${1:-}" = "--push" ]; then
  extra=()
else
  echo "DRY RUN — nothing published. Re-run with --push to do it for real."
  echo
fi

# --access public: scoped packages default to restricted.
# --no-git-checks: do not require a version tag.
pnpm --filter "./packages/**" -r publish --access public --no-git-checks "${extra[@]}"
