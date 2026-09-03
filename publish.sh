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

filters=()
for pkgjson in packages/*/package.json; do
  name=$(node -p "require('./$pkgjson').name")
  ver=$(node -p "require('./$pkgjson').version")
  if npm view "$name@$ver" version >/dev/null 2>&1; then
    echo "skip $name@$ver (already on npm)"
  else
    echo "publish $name@$ver"
    filters+=(--filter "$name")
  fi
done

if [ ${#filters[@]} -eq 0 ]; then
  echo "nothing to publish"
  exit 0
fi

# --access public: scoped packages default to restricted.
# --no-git-checks: do not require a version tag.
pnpm "${filters[@]}" -r publish --access public --no-git-checks "${extra[@]}"
