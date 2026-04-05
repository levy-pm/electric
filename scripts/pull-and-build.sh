#!/bin/bash
set -Eeuo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${SYNC_BRANCH:-main}"
LOCK_FILE="$APP_ROOT/tmp/deploy.lock"
DEPLOY_META="$APP_ROOT/tmp/deploy-meta.json"
CURRENT_HEAD=""
REMOTE_HEAD=""
DIRTY_BEFORE="false"

log() {
  echo "[$(date '+%F %T')] $*"
}

write_meta() {
  local status="$1"
  local message="$2"
  local deployed_head="${3:-}"
  local remote_head="${4:-}"
  local dirty_before="${5:-false}"

  cat > "$DEPLOY_META" <<EOF
{"status":"$status","time":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')","branch":"$BRANCH","deployedHead":"$deployed_head","remoteHead":"$remote_head","dirtyBefore":$dirty_before,"message":"$message"}
EOF
}

on_error() {
  local line="$1"
  local exit_code="$2"
  log "deploy failed at line $line (exit $exit_code)"
  write_meta "error" "deploy_failed_line_${line}_exit_${exit_code}" "$CURRENT_HEAD" "$REMOTE_HEAD" "$DIRTY_BEFORE"
}

trap 'on_error "$LINENO" "$?"' ERR

cd "$APP_ROOT"

if [ ! -d .git ]; then
  log "Brak repozytorium Git w $APP_ROOT"
  exit 1
fi

mkdir -p storage/logs tmp

if command -v flock >/dev/null 2>&1; then
  exec 200>"$LOCK_FILE"
  if ! flock -n 200; then
    log "Pomijam deploy - poprzedni sync nadal trwa."
    exit 0
  fi
fi

if [ "${1:-}" = "--status" ]; then
  CURRENT_HEAD="$(git rev-parse HEAD 2>/dev/null || echo '')"
  git fetch origin "$BRANCH" >/dev/null 2>&1 || true
  REMOTE_HEAD="$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo '')"
  if [ -n "$(git status --porcelain)" ]; then
    DIRTY_BEFORE="true"
  fi

  echo "app_root=$APP_ROOT"
  echo "branch=$BRANCH"
  echo "current_head=$CURRENT_HEAD"
  echo "remote_head=$REMOTE_HEAD"
  echo "dirty_before=$DIRTY_BEFORE"
  exit 0
fi

CURRENT_HEAD="$(git rev-parse HEAD 2>/dev/null || echo '')"
if [ -n "$(git status --porcelain)" ]; then
  DIRTY_BEFORE="true"
fi

log "Starting deploy sync for branch $BRANCH"
log "Current HEAD: ${CURRENT_HEAD:-unknown}"
log "Dirty before sync: $DIRTY_BEFORE"

git fetch origin "$BRANCH"
REMOTE_HEAD="$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo '')"

if [ -z "$REMOTE_HEAD" ]; then
  log "Nie udalo sie odczytac origin/$BRANCH"
  exit 1
fi

log "Remote HEAD: $REMOTE_HEAD"

if [ "$CURRENT_HEAD" = "$REMOTE_HEAD" ] && [ "$DIRTY_BEFORE" = "false" ]; then
  log "Brak zmian do wdrozenia."
  write_meta "ok" "no_changes" "$CURRENT_HEAD" "$REMOTE_HEAD" "$DIRTY_BEFORE"
  exit 0
fi

log "Synchronizuje repo do origin/$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd

if [ -n "$(git status --porcelain)" ]; then
  log "Repo po synchronizacji nadal nie jest czyste."
  git status --porcelain
  exit 1
fi

if command -v npm >/dev/null 2>&1; then
  if [ -f package-lock.json ]; then
    log "Uruchamiam npm ci --omit=dev"
    npm ci --omit=dev
  else
    log "Uruchamiam npm install --omit=dev"
    npm install --omit=dev
  fi
fi

touch tmp/restart.txt
CURRENT_HEAD="$(git rev-parse HEAD 2>/dev/null || echo '')"
log "Deploy zakonczony. Aktywny HEAD: $CURRENT_HEAD"
write_meta "ok" "deployed" "$CURRENT_HEAD" "$REMOTE_HEAD" "$DIRTY_BEFORE"
