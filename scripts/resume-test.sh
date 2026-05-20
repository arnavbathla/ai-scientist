#!/usr/bin/env bash
# Worker-restart resume test.
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/researchos_cookie.txt"
PROJECT_ID=$(curl -sS -b "$COOKIE" "$BASE/api/projects" | python3 -c 'import sys,json;p=json.load(sys.stdin)["projects"];print(p[0]["id"])')
echo "PROJECT_ID=$PROJECT_ID"

RUN=$(curl -sS -b "$COOKIE" -X POST "$BASE/api/runs" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"researchGoal\": \"Identify mechanistic interventions for slowing cellular aging in humans across senescence, mitochondrial dysfunction, telomere attrition, and proteostasis loss pathways. Resume-test scenario.\",
    \"domain\": \"Aging biology\",
    \"maxHypotheses\": 4,
    \"maxIterations\": 10,
    \"maxRuntimeMinutes\": 8,
    \"maxSources\": 20
  }")
echo "RUN=$RUN"
RUN_ID=$(echo "$RUN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["run"]["id"])')
echo "RUN_ID=$RUN_ID"
echo "$RUN_ID" > /tmp/researchos_resume_run.txt
