#!/usr/bin/env bash
# Deploys the latest code on the server: pull, install, migrate, build, restart, health check.
#
#   scripts/deploy.sh                 # deploy the branch that is checked out
#   BRANCH=main scripts/deploy.sh     # deploy a specific branch
#   SKIP_PULL=1 scripts/deploy.sh     # rebuild and restart the code as it is (e.g. after checking out an older commit)
#
# Requirements on the server: backend/.env and frontend/.env filled in (see the .env.example files),
# Ruby/Bundler and Node/npm on PATH, and permission to run `systemctl restart` (root or sudo).
# The script stops at the first failing step; services are only restarted after everything built.
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root (this script lives in scripts/)
BACKEND="$APP_DIR/backend"
FRONTEND="$APP_DIR/frontend"
SERVICES=(sashauto-rails sashauto-sidekiq sashauto-web)

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mDeploy failed: %s\033[0m\n' "$*" >&2; exit 1; }
trap 'fail "step at line $LINENO exited with an error (see output above)"' ERR

SUDO=""
[[ $EUID -ne 0 ]] && SUDO="sudo"

# Only one deploy at a time.
exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || fail "another deploy is already running"

# Read KEY from an .env file (value without quotes), or print the default.
env_value() {
  local file=$1 key=$2 default=$3 value=""
  [[ -f $file ]] && value=$(grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | tr -d "\"'" || true)
  printf '%s' "${value:-$default}"
}

cd "$APP_DIR"
[[ -f "$BACKEND/.env" ]]  || fail "backend/.env is missing (copy backend/.env.example and fill it in)"
[[ -f "$FRONTEND/.env" ]] || fail "frontend/.env is missing (copy frontend/.env.example and fill it in)"

# ---------------------------------------------------------------------------------------------- code
PREVIOUS=$(git rev-parse HEAD)
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
if [[ -n "${SKIP_PULL:-}" ]]; then
  log "Skipping git pull (SKIP_PULL set): deploying ${PREVIOUS:0:8} as checked out"
  CURRENT=$PREVIOUS
  LOCK_BEFORE="force-npm-ci"
  LOCK_AFTER=""
else
  log "Pulling the latest code"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    git status --short
    fail "the server has uncommitted changes to tracked files; commit, stash or discard them first"
  fi
  LOCK_BEFORE=$(git rev-parse HEAD:frontend/package-lock.json 2>/dev/null || true)
  git fetch --prune origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
  CURRENT=$(git rev-parse HEAD)
  LOCK_AFTER=$(git rev-parse HEAD:frontend/package-lock.json 2>/dev/null || true)
  echo "Branch $BRANCH: ${PREVIOUS:0:8} -> ${CURRENT:0:8}"
  git log --oneline "$PREVIOUS..$CURRENT" | head -n 20 || true
fi

# ------------------------------------------------------------------------------------------- backend
log "Backend: installing gems"
cd "$BACKEND"
BUNDLE_WITHOUT="development:test" bundle install --jobs 4 --retry 3

log "Backend: running database migrations"
RAILS_ENV=production bin/rails db:migrate

# ------------------------------------------------------------------------------------------ frontend
cd "$FRONTEND"
if [[ ! -d node_modules || "$LOCK_BEFORE" != "$LOCK_AFTER" ]]; then
  log "Frontend: installing packages (package-lock.json changed or node_modules missing)"
  npm ci
else
  log "Frontend: packages unchanged, skipping npm ci"
fi

log "Frontend: building for production"
grep -qE '^BACKEND_URL=.+' .env || fail "BACKEND_URL is not set in frontend/.env"
NODE_ENV=production npm run build

# ---------------------------------------------------------------------------------------- services
log "Restarting services: ${SERVICES[*]}"
$SUDO systemctl restart "${SERVICES[@]}"

# ------------------------------------------------------------------------------------ health checks
API_PORT=$(env_value "$BACKEND/.env" PORT 4000)
WEB_PORT=${WEB_PORT:-3000}

wait_for() {
  local name=$1 url=$2
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null --max-time 3 "$url"; then echo "$name is up ($url)"; return 0; fi
    sleep 2
  done
  return 1
}

log "Checking the services"
wait_for "Rails API" "http://127.0.0.1:$API_PORT/up" || fail "Rails did not answer on port $API_PORT (journalctl -u sashauto-rails -n 100)"
wait_for "Next.js"   "http://127.0.0.1:$WEB_PORT/login" || fail "Next.js did not answer on port $WEB_PORT (journalctl -u sashauto-web -n 100)"
for service in "${SERVICES[@]}"; do
  $SUDO systemctl is-active --quiet "$service" || fail "$service is not running (journalctl -u $service -n 100)"
done
echo "All services are active: ${SERVICES[*]}"

trap - ERR
log "Deployed ${CURRENT:0:8} on $BRANCH"
if [[ "$PREVIOUS" != "$CURRENT" ]]; then
  echo "To roll back the code: git checkout ${PREVIOUS:0:8} && SKIP_PULL=1 scripts/deploy.sh   (database migrations are not undone)"
fi
