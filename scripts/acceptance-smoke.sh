#!/usr/bin/env bash
# ResearchOS API-only smoke check.
#
# Verifies every Cursor-style API surface added in the overhaul:
#   register/login/session, project, skill CRUD, run with skillIds,
#   messages, skip, interrupt, config (addIterations + finishNow).
# It does NOT poll for full LLM completion — that is what acceptance.sh does.
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

say() { printf "\n=== %s ===\n" "$*"; }
fail() { printf "\nERROR: %s\n" "$*" >&2; exit 1; }
json_field() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

say "register"
EMAIL="smoke-$(date +%s)@researchos.local"
PASSWORD="smokesmoke1234"
curl -sS -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Smoke\"}" >/dev/null

say "login"
CSRF=$(curl -sS -c "$COOKIE" "$BASE/api/auth/csrf" | json_field '["csrfToken"]')
curl -sS -b "$COOKIE" -c "$COOKIE" -o /dev/null -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "password=$PASSWORD" \
  --data-urlencode "redirect=false" --data-urlencode "json=true"
curl -sS -b "$COOKIE" "$BASE/api/auth/session" | grep -q '"user"' || fail "login failed"

say "project"
PROJ=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/projects" \
  -H "Content-Type: application/json" \
  -d '{"title":"Smoke project"}')
PROJECT_ID=$(echo "$PROJ" | json_field '["project"]["id"]')
echo "project=$PROJECT_ID"

say "skill: create"
SKILL=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/skills" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Mechanism first",
    "description":"Prefer mechanism-grounded hypotheses",
    "body":"Always anchor every hypothesis claim to a specific molecular or cellular mechanism."
  }')
SKILL_ID=$(echo "$SKILL" | json_field '["skill"]["id"]')
echo "skill=$SKILL_ID"

say "skill: list"
curl -sS -b "$COOKIE" "$BASE/api/skills" | grep -q "$SKILL_ID" || fail "skill not in list"

say "skill: patch"
PATCH_RESP=$(curl -sS -b "$COOKIE" -X PATCH "$BASE/api/skills/$SKILL_ID" \
  -H "Content-Type: application/json" \
  -d '{"body":"Anchor every hypothesis to a specific molecular or cellular mechanism. Cite a PMID."}')
echo "$PATCH_RESP" | grep -q 'PMID' || { echo "patch response: $PATCH_RESP"; fail "skill patch failed"; }

say "run: create with skillIds"
RUN=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/runs" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"researchGoal\": \"Smoke test the Cursor-style ResearchOS overhaul API surface end to end.\",
    \"maxIterations\": 3,
    \"maxRuntimeMinutes\": 2,
    \"maxSources\": 10,
    \"maxHypotheses\": 3,
    \"skillIds\": [\"$SKILL_ID\"]
  }")
RUN_ID=$(echo "$RUN" | json_field '["run"]["id"]')
echo "run=$RUN_ID"

say "run skills"
curl -sS -b "$COOKIE" "$BASE/api/runs/$RUN_ID/skills" | grep -q "$SKILL_ID" || fail "run skill not attached"

say "messages: follow-up"
curl -sS -b "$COOKIE" -X POST "$BASE/api/runs/$RUN_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"content":"Focus on mitochondrial mechanisms."}' \
  | grep -q '"runId"' || fail "messages POST failed"

say "skip: disable EvolutionAgent"
curl -sS -b "$COOKIE" -X POST "$BASE/api/runs/$RUN_ID/skip" \
  -H "Content-Type: application/json" \
  -d '{"agentName":"EvolutionAgent"}' \
  | grep -q '"EvolutionAgent"' || fail "skip POST failed"

say "skip: current step"
curl -sS -b "$COOKIE" -X POST "$BASE/api/runs/$RUN_ID/skip" \
  -H "Content-Type: application/json" \
  -d '{"currentOnly":true}' >/dev/null

say "interrupt"
curl -sS -b "$COOKIE" -X POST "$BASE/api/runs/$RUN_ID/interrupt" \
  -H "Content-Type: application/json" >/dev/null

say "config: addIterations + addRuntimeMinutes"
curl -sS -b "$COOKIE" -X PATCH "$BASE/api/runs/$RUN_ID/config" \
  -H "Content-Type: application/json" \
  -d '{"addIterations":5,"addRuntimeMinutes":15}' \
  | grep -q '"maxIterations"' || fail "config patch failed"

say "config: finishNow"
curl -sS -b "$COOKIE" -X PATCH "$BASE/api/runs/$RUN_ID/config" \
  -H "Content-Type: application/json" \
  -d '{"finishNow":true}' \
  | grep -q '"maxIterations"' || fail "finishNow failed"

say "cancel"
curl -sS -b "$COOKIE" -X POST "$BASE/api/runs/$RUN_ID/cancel" -H "Content-Type: application/json" >/dev/null || true

say "skill: delete"
curl -sS -b "$COOKIE" -X DELETE "$BASE/api/skills/$SKILL_ID" >/dev/null

echo
echo "=== smoke OK ==="
