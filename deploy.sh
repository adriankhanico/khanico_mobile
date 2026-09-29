#!/usr/bin/env bash
# Deploys the latest main on this server: pull, rebuild, health check.
#
# Refuses to run if this checkout has local edits, so code changed directly on
# the server is never overwritten or silently left out of git. Those edits are
# saved to a patch in $HOME first; get them into git from a dev machine
# (commit + push), then discard them here and deploy again.
set -euo pipefail
cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  backup="$HOME/khanico-uncommitted-$(date +%Y%m%d-%H%M%S).patch"
  git diff HEAD > "$backup"
  echo "Refusing to deploy: this checkout has changes that aren't in git:" >&2
  git status --short >&2
  echo >&2
  echo "Edits to tracked files were saved to $backup" >&2
  echo "Commit and push them from a dev machine, then run 'git checkout -- .' here and deploy again." >&2
  exit 1
fi

git pull --ff-only
docker compose up -d --build

for _ in $(seq 1 30); do
  if curl -fsS http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "Deployed: $(git log --oneline -1)"
    exit 0
  fi
  sleep 1
done
echo "Deploy finished but the health check at http://localhost:3001/api/health isn't answering." >&2
exit 1
