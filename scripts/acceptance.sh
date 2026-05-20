#!/usr/bin/env bash
# 28-step acceptance test driver. Hits the running dev server on :3000.
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

echo "=== STEP 10: register a fresh acceptance user ==="
EMAIL="accept-$(date +%s)@researchos.local"
REG=$(curl -sS -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"acceptance1234\",\"name\":\"Acceptance Tester\"}")
echo "register: $REG"

echo "=== STEP 11: login (NextAuth credentials) ==="
CSRF_JSON=$(curl -sS -c "$COOKIE" "$BASE/api/auth/csrf")
CSRF=$(echo "$CSRF_JSON" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
echo "csrf token len=${#CSRF}"
LOGIN=$(curl -sS -b "$COOKIE" -c "$COOKIE" -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "password=acceptance1234" \
  --data-urlencode "redirect=false" \
  --data-urlencode "json=true" \
  -w "\nHTTP_STATUS:%{http_code}")
echo "login: $LOGIN" | head -c 500
echo
echo "cookies after login:"
grep -E "next-auth|authjs" "$COOKIE" || true

echo "=== STEP 12: confirm session via /api/auth/session ==="
SESS=$(curl -sS -b "$COOKIE" "$BASE/api/auth/session")
echo "session: $SESS"

echo "=== STEP 13: create a project ==="
PROJECT=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/projects" \
  -H "Content-Type: application/json" \
  -d '{"title":"Cellular Aging — Acceptance","description":"E2E acceptance run","domain":"Aging biology"}')
echo "project: $PROJECT"
PROJECT_ID=$(echo "$PROJECT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["project"]["id"])')
echo "PROJECT_ID=$PROJECT_ID"

echo "=== STEP 14: start a research run ==="
RUN=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/runs" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"researchGoal\": \"Identify the most promising mechanistic targets for slowing cellular aging in humans, focusing on validated longevity pathways such as senescence clearance, mitochondrial dysfunction, telomere attrition, and proteostasis loss. Prioritize hypotheses with strong human translational potential.\",
    \"domain\": \"Aging biology\",
    \"constraints\": { \"excludedDirections\": [\"germline gene editing in humans\"] },
    \"maxHypotheses\": 6,
    \"maxIterations\": 12,
    \"maxRuntimeMinutes\": 8,
    \"maxSources\": 30
  }")
echo "run: $RUN"
RUN_ID=$(echo "$RUN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["run"]["id"])')
echo "RUN_ID=$RUN_ID"
echo "$RUN_ID" > /tmp/researchos_run_id.txt
echo "$EMAIL" > /tmp/researchos_email.txt
cp "$COOKIE" /tmp/researchos_cookie.txt
echo "RUN_ID + cookie written"
