#!/bin/bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"

if [ ! -d .git ]; then
  echo "Brak repozytorium Git w $APP_ROOT"
  exit 1
fi

mkdir -p storage/logs tmp

CURRENT_HEAD="$(git rev-parse HEAD 2>/dev/null || echo '')"

git fetch origin "${SYNC_BRANCH:-main}"
git pull --ff-only origin "${SYNC_BRANCH:-main}"

NEW_HEAD="$(git rev-parse HEAD 2>/dev/null || echo '')"

if [ "$CURRENT_HEAD" != "$NEW_HEAD" ]; then
  if command -v npm >/dev/null 2>&1; then
    npm install --omit=dev
  fi

  touch tmp/restart.txt
  echo "$(date '+%F %T') deployed $NEW_HEAD"
else
  echo "$(date '+%F %T') no changes"
fi
