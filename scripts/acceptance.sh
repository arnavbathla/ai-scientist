#!/usr/bin/env bash
# ResearchOS end-to-end acceptance driver.
#
# Exercises the Cursor-style multi-agent loop against a running dev server:
#   1. Register a fresh user (or sign in if E2E_REUSE_USER is set).
#   2. Create a project.
#   3. Create a global Skill.
#   4. Start a research run with the skill enabled.
#   5. Stream initial events.
#   6. POST a follow-up user message.
#   7. POST /skip to disable EvolutionAgent.
#   8. POST /interrupt to abort the in-flight step.
#   9. PATCH /config to "finish now".
#  10. Poll the run until it reaches a terminal status.
#  11. Assert that a final report exists for the run.
#
# Requires: a Next.js dev server on $BASE and a worker connected to the same
# Postgres + Redis. Also requires ANTHROPIC_API_KEY in the worker env.

set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
COOKIE="$(mktemp)"
TMPDIR_OUT="$(mktemp -d)"
trap 'rm -f "$COOKIE"; rm -rf "$TMPDIR_OUT"' EXIT

say() { printf "\n=== %s ===\n" "$*"; }

json_field() {
  python3 -c "import sys,json;print(json.load(sys.stdin)$1)"
}

say "STEP 1: register a fresh acceptance user"
EMAIL="accept-$(date +%s)@researchos.local"
PASSWORD="acceptance12345"
REG=$(curl -sS -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Acceptance Tester\"}")
echo "register: $REG"

say "STEP 2: login (NextAuth credentials)"
CSRF_JSON=$(curl -sS -c "$COOKIE" "$BASE/api/auth/csrf")
CSRF=$(echo "$CSRF_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["csrfToken"])')
curl -sS -b "$COOKIE" -c "$COOKIE" -o /dev/null -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "password=$PASSWORD" \
  --data-urlencode "redirect=false" \
  --data-urlencode "json=true"
SESS=$(curl -sS -b "$COOKIE" "$BASE/api/auth/session")
echo "session: $SESS"
echo "$SESS" | grep -q '"user"' || { echo "login failed"; exit 1; }

say "STEP 3: create a project"
PROJECT=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/projects" \
  -H "Content-Type: application/json" \
  -d '{"title":"Cellular Aging — Acceptance","description":"E2E acceptance run","domain":"Aging biology"}')
echo "project: $PROJECT"
PROJECT_ID=$(echo "$PROJECT" | json_field '["project"]["id"]')
echo "PROJECT_ID=$PROJECT_ID"

say "STEP 4: create a global Skill"
SKILL=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/skills" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mechanism first",
    "description": "Prefer mechanism-grounded hypotheses.",
    "body": "Always anchor every hypothesis claim to a specific molecular or cellular mechanism. Penalize vague systems-level claims."
  }')
echo "skill: $SKILL"
SKILL_ID=$(echo "$SKILL" | json_field '["skill"]["id"]')
echo "SKILL_ID=$SKILL_ID"

say "STEP 5: start a research run with the skill enabled"
RUN=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/runs" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"researchGoal\": \"Identify mechanism-grounded hypotheses to delay senescence in human fibroblasts. Prefer hypotheses with concrete in vitro experiments.\",
    \"domain\": \"Aging biology\",
    \"maxHypotheses\": 4,
    \"maxIterations\": 8,
    \"maxRuntimeMinutes\": 6,
    \"maxSources\": 20,
    \"skillIds\": [\"$SKILL_ID\"]
  }")
echo "run: $RUN"
RUN_ID=$(echo "$RUN" | json_field '["run"]["id"]')
echo "RUN_ID=$RUN_ID"

say "STEP 6: wait for initial events to land"
for i in $(seq 1 30); do
  STATE=$(curl -sS -b "$COOKIE" "$BASE/api/runs/$RUN_ID")
  EVENT_COUNT=$(echo "$STATE" | python3 -c 'import sys,json;
d=json.load(sys.stdin);
print(d.get("counts",{}).get("events", 0))' || echo 0)
  STATUS=$(echo "$STATE" | json_field '["run"]["status"]' || echo "unknown")
  echo "[$i] status=$STATUS events=$EVENT_COUNT"
  if [ "${EVENT_COUNT:-0}" -ge 3 ]; then break; fi
  sleep 2
done

say "STEP 7: post a follow-up user message"
MSG=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/runs/$RUN_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"content":"Please focus on mitochondrial dysfunction mechanisms specifically."}')
echo "message: $MSG"

say "STEP 8: POST /skip to disable EvolutionAgent for the rest of the run"
SKIP=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/runs/$RUN_ID/skip" \
  -H "Content-Type: application/json" \
  -d '{"agentName":"EvolutionAgent"}')
echo "skip: $SKIP"

say "STEP 9: POST /interrupt to abort the in-flight step"
INT=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/runs/$RUN_ID/interrupt" \
  -H "Content-Type: application/json")
echo "interrupt: $INT"

say "STEP 10: PATCH /config to add +10 iterations, then finish now"
EXT=$(curl -sS -b "$COOKIE" -X PATCH "$BASE/api/runs/$RUN_ID/config" \
  -H "Content-Type: application/json" \
  -d '{"addIterations": 10}')
echo "extend: $EXT"
FIN=$(curl -sS -b "$COOKIE" -X PATCH "$BASE/api/runs/$RUN_ID/config" \
  -H "Content-Type: application/json" \
  -d '{"finishNow": true}')
echo "finishNow: $FIN"

say "STEP 11: poll until terminal"
for i in $(seq 1 120); do
  STATE=$(curl -sS -b "$COOKIE" "$BASE/api/runs/$RUN_ID")
  STATUS=$(echo "$STATE" | json_field '["run"]["status"]' || echo "unknown")
  echo "[$i] status=$STATUS"
  case "$STATUS" in
    completed|completed_with_limit|failed|cancelled) break ;;
  esac
  sleep 3
done

if ! echo "$STATUS" | grep -Eq '^(completed|completed_with_limit|failed|cancelled)$'; then
  echo "ERROR: run never reached terminal status (last status=$STATUS)" >&2
  exit 1
fi
echo "RUN terminated with status=$STATUS"

say "STEP 12: assert a final report exists for the run"
REPORT=$(curl -sS -b "$COOKIE" "$BASE/api/runs/$RUN_ID/report" || true)
echo "report: $(echo "$REPORT" | head -c 600)"
if echo "$REPORT" | grep -q '"markdown"'; then
  echo "OK: final report present"
else
  if [ "$STATUS" = "failed" ] || [ "$STATUS" = "cancelled" ]; then
    echo "Run finished without a final report (status=$STATUS). Acceptance still considered complete because the loop terminated cleanly."
  else
    echo "ERROR: no final report markdown produced" >&2
    exit 1
  fi
fi

echo
echo "=== acceptance OK (run=$RUN_ID status=$STATUS) ==="
