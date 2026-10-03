#!/usr/bin/env bash
# Deploys the latest code on the server: pull, install, migrate, build, restart, health check.
#
#   scripts/deploy.sh                 # deploy the branch that is checked out
#   BRANCH=main scripts/deploy.sh     # deploy a specific branch
#   SKIP_PULL=1 scripts/deploy.sh     # rebuild and restart the code as it is (e.g. after a manual pull or rollback)
#
# Can be run as root or as the app user. Every git/bundle/rails/npm step runs as the user the services run
# as (User= of sashauto-rails), with the same Ruby and Node the services use, so no file ends up owned by
# root. Only `systemctl restart` needs root (sudo is used when not root).
#
# Optional overrides: APP_USER=<user>, NODE_BIN=<dir with node/npm>, RUBY_BIN=<dir with ruby/bundle>,
# WEB_PORT=<Next.js port, default 3000>.
#
# Requirements: backend/.env and frontend/.env filled in (see the .env.example files).
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

# ------------------------------------------------------------------------------ who and which tools
# The user the services run as (falls back to the owner of the project folder, then the current user).
APP_USER="${APP_USER:-$(systemctl show -p User --value sashauto-rails 2>/dev/null || true)}"
[[ -z "$APP_USER" ]] && APP_USER="$(stat -c %U "$APP_DIR")"
id "$APP_USER" >/dev/null 2>&1 || fail "user '$APP_USER' does not exist (set APP_USER=...)"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
APP_GROUP="$(id -gn "$APP_USER")"

# PATH used for every build step: the folders of the programs the services start (e.g. .../node/bin,
# .../.rbenv/shims), PATH set in the unit files, common per-user version managers, then the normal PATH.
tool_path() {
  local dirs=() dir
  [[ -n "${NODE_BIN:-}" ]] && dirs+=("$NODE_BIN")
  [[ -n "${RUBY_BIN:-}" ]] && dirs+=("$RUBY_BIN")
  for service in "${SERVICES[@]}"; do
    while read -r dir; do [[ -n "$dir" ]] && dirs+=("$(dirname "$dir")"); done \
      < <(systemctl show -p ExecStart --value "$service" 2>/dev/null | grep -oE 'path=[^ ;]+' | cut -d= -f2 || true)
    while read -r dir; do [[ -n "$dir" ]] && dirs+=("$dir"); done \
      < <(systemctl show -p Environment --value "$service" 2>/dev/null | tr ' ' '\n' | grep '^PATH=' | cut -d= -f2- | tr ':' '\n' || true)
  done
  for dir in "$APP_HOME/.rbenv/shims" "$APP_HOME/.rbenv/bin" "$APP_HOME/.asdf/shims" \
             "$APP_HOME/.local/share/mise/shims" "$APP_HOME/.volta/bin" "$APP_HOME/.local/bin"; do
    dirs+=("$dir")
  done
  # Newest Node installed with nvm, if any.
  dir=$(ls -d "$APP_HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -n1 || true)
  [[ -n "$dir" ]] && dirs+=("$dir")
  dirs+=(/usr/local/sbin /usr/local/bin /usr/sbin /usr/bin /sbin /bin)
  local path="" seen=":"
  for dir in "${dirs[@]}"; do
    [[ -d "$dir" && "$seen" != *":$dir:"* ]] && { path+="${path:+:}$dir"; seen+="$dir:"; }
  done
  printf '%s' "$path"
}
TOOL_PATH="$(tool_path)"

# Runs a shell command in a folder as the app user with TOOL_PATH.
as_app() {
  local dir=$1; shift
  if [[ $EUID -eq 0 && "$APP_USER" != "root" ]]; then
    sudo -u "$APP_USER" -H env PATH="$TOOL_PATH" bash -c "cd '$dir' && $*"
  else
    env PATH="$TOOL_PATH" bash -c "cd '$dir' && $*"
  fi
}

# Read KEY from an .env file (value without quotes), or print the default.
env_value() {
  local file=$1 key=$2 default=$3 value=""
  [[ -f $file ]] && value=$(grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | tr -d "\"'" || true)
  printf '%s' "${value:-$default}"
}

# ---------------------------------------------------------------------------------------------- checks
cd "$APP_DIR"
[[ -f "$BACKEND/.env" ]]  || fail "backend/.env is missing (copy backend/.env.example and fill it in)"
[[ -f "$FRONTEND/.env" ]] || fail "frontend/.env is missing (copy frontend/.env.example and fill it in)"

# Only one deploy at a time.
exec 9>"/tmp/sashauto-deploy.lock"
flock -n 9 || fail "another deploy is already running"

log "Deploying as $APP_USER"
echo "node:   $(as_app "$APP_DIR" 'command -v node || true')"
echo "npm:    $(as_app "$APP_DIR" 'command -v npm || true')"
echo "bundle: $(as_app "$APP_DIR" 'command -v bundle || true')"
as_app "$APP_DIR" 'command -v npm >/dev/null' || fail "npm not found for $APP_USER; run with NODE_BIN=/path/to/node/bin"
as_app "$APP_DIR" 'command -v bundle >/dev/null' || fail "bundle not found for $APP_USER; run with RUBY_BIN=/path/to/ruby/bin"

# Files created by an earlier run as root (bundle, bootsnap cache, .next) go back to the app user.
if [[ $EUID -eq 0 && "$APP_USER" != "root" ]]; then
  root_owned=$(find "$APP_DIR" -path "$FRONTEND/node_modules" -prune -o -user root -print -quit 2>/dev/null || true)
  if [[ -n "$root_owned" ]] || [[ -d "$FRONTEND/node_modules" && -n "$(find "$FRONTEND/node_modules" -maxdepth 1 -user root -print -quit)" ]]; then
    log "Giving files owned by root back to $APP_USER"
    chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
  fi
fi

# ---------------------------------------------------------------------------------------------- code
PREVIOUS=$(as_app "$APP_DIR" 'git rev-parse HEAD')
BRANCH="${BRANCH:-$(as_app "$APP_DIR" 'git rev-parse --abbrev-ref HEAD')}"
if [[ -n "${SKIP_PULL:-}" ]]; then
  log "Skipping git pull (SKIP_PULL set): deploying ${PREVIOUS:0:8} as checked out"
  CURRENT=$PREVIOUS
  LOCK_BEFORE="force-npm-ci"
  LOCK_AFTER=""
else
  log "Pulling the latest code"
  if ! as_app "$APP_DIR" 'git diff --quiet && git diff --cached --quiet'; then
    as_app "$APP_DIR" 'git status --short'
    fail "the server has uncommitted changes to tracked files; commit, stash or discard them first"
  fi
  LOCK_BEFORE=$(as_app "$APP_DIR" 'git rev-parse HEAD:frontend/package-lock.json 2>/dev/null || true')
  as_app "$APP_DIR" "git fetch --prune origin && git checkout '$BRANCH' && git pull --ff-only origin '$BRANCH'"
  CURRENT=$(as_app "$APP_DIR" 'git rev-parse HEAD')
  LOCK_AFTER=$(as_app "$APP_DIR" 'git rev-parse HEAD:frontend/package-lock.json 2>/dev/null || true')
  echo "Branch $BRANCH: ${PREVIOUS:0:8} -> ${CURRENT:0:8}"
  as_app "$APP_DIR" "git log --oneline '$PREVIOUS..$CURRENT' | head -n 20" || true
fi

# ------------------------------------------------------------------------------------------- backend
log "Backend: installing gems"
# The app runs as root on some servers; Bundler's "don't run as root" warning does not apply then.
as_app "$BACKEND" 'BUNDLE_SILENCE_ROOT_WARNING=1 BUNDLE_WITHOUT=development:test bundle install --jobs 4 --retry 3'

log "Backend: running database migrations"
as_app "$BACKEND" 'RAILS_ENV=production bin/rails db:migrate'

# ------------------------------------------------------------------------------------------ frontend
if [[ ! -d "$FRONTEND/node_modules" || "$LOCK_BEFORE" != "$LOCK_AFTER" ]]; then
  log "Frontend: installing packages (package-lock.json changed or node_modules missing)"
  as_app "$FRONTEND" 'npm ci'
else
  log "Frontend: packages unchanged, skipping npm ci"
fi

log "Frontend: building for production"
grep -qE '^BACKEND_URL=.+' "$FRONTEND/.env" || fail "BACKEND_URL is not set in frontend/.env"
as_app "$FRONTEND" 'NODE_ENV=production npm run build'

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
