-- Cursor-style ResearchOS overhaul migration.
-- 1) Drop SafetyAgent surface (model, enums, columns).
-- 2) Add Skills library (Skill + RunSkill) with SkillScope enum.
-- 3) Add live-controls columns to ResearchRun (disabledAgents, skipCurrent).
-- 4) Add MemoryType.user_instruction enum value.
-- 5) Add RunMessage table for chat-thread persistence.

-- ----------------------------------------------------------------
-- 1. SafetyAgent removal
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS "SafetyFlag";

-- Remove safety column from ResearchRun.
ALTER TABLE "ResearchRun" DROP COLUMN IF EXISTS "safetySensitivity";

-- Enum value removals require rewriting the type. We do that by:
-- (a) renaming the existing type, (b) creating a new one without the value,
-- (c) ALTERing affected columns to use the new type, (d) dropping the old one.

-- RunStatus: drop "blocked"
ALTER TYPE "RunStatus" RENAME TO "RunStatus_old";
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'paused', 'completed', 'completed_with_limit', 'failed', 'cancelled');
ALTER TABLE "ResearchRun" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ResearchRun"
  ALTER COLUMN "status" TYPE "RunStatus"
  USING (
    CASE
      WHEN "status"::text = 'blocked' THEN 'cancelled'::"RunStatus"
      ELSE "status"::text::"RunStatus"
    END
  );
ALTER TABLE "ResearchRun" ALTER COLUMN "status" SET DEFAULT 'queued';
DROP TYPE "RunStatus_old";

-- SessionStatus: drop "blocked"
ALTER TYPE "SessionStatus" RENAME TO "SessionStatus_old";
CREATE TYPE "SessionStatus" AS ENUM ('active', 'paused', 'completed', 'failed', 'cancelled');
ALTER TABLE "AgentSession" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "AgentSession"
  ALTER COLUMN "status" TYPE "SessionStatus"
  USING (
    CASE
      WHEN "status"::text = 'blocked' THEN 'cancelled'::"SessionStatus"
      ELSE "status"::text::"SessionStatus"
    END
  );
ALTER TABLE "AgentSession" ALTER COLUMN "status" SET DEFAULT 'active';
DROP TYPE "SessionStatus_old";

-- MemoryType: drop "safety_note", add "user_instruction"
ALTER TYPE "MemoryType" RENAME TO "MemoryType_old";
CREATE TYPE "MemoryType" AS ENUM (
  'objective',
  'plan',
  'progress',
  'finding',
  'source_summary',
  'hypothesis_summary',
  'critique_summary',
  'decision',
  'blocker',
  'user_instruction',
  'final_summary'
);
ALTER TABLE "AgentMemory"
  ALTER COLUMN "memoryType" TYPE "MemoryType"
  USING (
    CASE
      WHEN "memoryType"::text = 'safety_note' THEN 'finding'::"MemoryType"
      ELSE "memoryType"::text::"MemoryType"
    END
  );
DROP TYPE "MemoryType_old";

-- CheckpointType: drop "safety_block"
ALTER TYPE "CheckpointType" RENAME TO "CheckpointType_old";
CREATE TYPE "CheckpointType" AS ENUM (
  'initialization',
  'iteration',
  'phase_transition',
  'compaction',
  'failure_recovery',
  'completion',
  'budget_limit'
);
ALTER TABLE "AgentCheckpoint"
  ALTER COLUMN "checkpointType" TYPE "CheckpointType"
  USING (
    CASE
      WHEN "checkpointType"::text = 'safety_block' THEN 'failure_recovery'::"CheckpointType"
      ELSE "checkpointType"::text::"CheckpointType"
    END
  );
DROP TYPE "CheckpointType_old";

-- EvalType: drop "safety"
ALTER TYPE "EvalType" RENAME TO "EvalType_old";
CREATE TYPE "EvalType" AS ENUM (
  'source_quality',
  'hypothesis_quality',
  'evidence_grounding',
  'novelty',
  'final_report_quality',
  'end_to_end'
);
ALTER TABLE "AgentEval"
  ALTER COLUMN "evalType" TYPE "EvalType"
  USING (
    CASE
      WHEN "evalType"::text = 'safety' THEN 'end_to_end'::"EvalType"
      ELSE "evalType"::text::"EvalType"
    END
  );
DROP TYPE "EvalType_old";

DROP TYPE IF EXISTS "SafetySeverity";
DROP TYPE IF EXISTS "SafetyCategory";

-- ----------------------------------------------------------------
-- 2. Skills library
-- ----------------------------------------------------------------
CREATE TYPE "SkillScope" AS ENUM ('global', 'project');

CREATE TABLE "Skill" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "projectId"   TEXT,
  "name"        TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "scope"       "SkillScope" NOT NULL DEFAULT 'global',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Skill"
  ADD CONSTRAINT "Skill_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Skill"
  ADD CONSTRAINT "Skill_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Skill_userId_scope_idx" ON "Skill"("userId", "scope");
CREATE INDEX "Skill_projectId_idx" ON "Skill"("projectId");

CREATE TABLE "RunSkill" (
  "runId"   TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "RunSkill_pkey" PRIMARY KEY ("runId", "skillId")
);
ALTER TABLE "RunSkill"
  ADD CONSTRAINT "RunSkill_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunSkill"
  ADD CONSTRAINT "RunSkill_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "RunSkill_runId_idx" ON "RunSkill"("runId");

-- ----------------------------------------------------------------
-- 3. Live runtime controls on ResearchRun
-- ----------------------------------------------------------------
ALTER TABLE "ResearchRun"
  ADD COLUMN "disabledAgents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "skipCurrent"    BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------
-- 4. User chat-thread messages
-- ----------------------------------------------------------------
CREATE TABLE "RunMessage" (
  "id"        TEXT NOT NULL,
  "runId"     TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunMessage_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "RunMessage"
  ADD CONSTRAINT "RunMessage_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunMessage"
  ADD CONSTRAINT "RunMessage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "RunMessage_runId_createdAt_idx" ON "RunMessage"("runId", "createdAt");
