#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-https://codes-backend-production.up.railway.app}"
FRONTEND_URL="${FRONTEND_URL:-https://www.cosmosx.tech}"
BACKUP_URL="${BACKUP_URL:-https://backup.cosmosx.tech}"

ok() { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

check_200() {
  local name="$1"; shift
  local url="$1"; shift
  local code
  code=$(curl -sS -o /tmp/smoke_body.txt -w "%{http_code}" "$url") || fail "$name network error ($url)"
  [[ "$code" == "200" ]] || fail "$name expected 200 got $code ($url)"
  ok "$name ($code)"
}

check_not_5xx() {
  local name="$1"; shift
  local url="$1"; shift
  local code
  code=$(curl -sS -o /tmp/smoke_body.txt -w "%{http_code}" "$url") || fail "$name network error ($url)"
  [[ "$code" =~ ^5 ]] && fail "$name got 5xx ($code) ($url)"
  ok "$name ($code)"
}

echo "Running production smoke checks..."

check_200 "Backend health" "$BACKEND_URL/health"
check_200 "Frontend login" "$FRONTEND_URL/login?next=%2F"
check_200 "Backup login" "$BACKUP_URL/login?next=%2F"
check_not_5xx "Catalog endpoint" "$BACKEND_URL/codes/tools/catalogs"

# Login endpoint should not fail with 5xx for bad creds
login_code=$(curl -sS -o /tmp/smoke_login.txt -w "%{http_code}" \
  -X POST "$BACKEND_URL/auth/login" \
  -H 'content-type: application/json' \
  -d '{"username":"smoke-user","password":"invalid"}') || fail "Auth login network error"
[[ "$login_code" =~ ^5 ]] && fail "Auth login returned 5xx ($login_code)"
ok "Auth login negative check ($login_code)"

echo "\nAll smoke checks passed."