-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'paused', 'completed', 'completed_with_limit', 'failed', 'cancelled', 'blocked');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('active', 'paused', 'completed', 'failed', 'cancelled', 'blocked');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'running', 'blocked', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('objective', 'plan', 'progress', 'finding', 'source_summary', 'hypothesis_summary', 'critique_summary', 'decision', 'blocker', 'safety_note', 'final_summary');

-- CreateEnum
CREATE TYPE "CheckpointType" AS ENUM ('initialization', 'iteration', 'phase_transition', 'compaction', 'failure_recovery', 'completion', 'budget_limit', 'safety_block');

-- CreateEnum
CREATE TYPE "EvalType" AS ENUM ('source_quality', 'hypothesis_quality', 'evidence_grounding', 'novelty', 'safety', 'final_report_quality', 'end_to_end');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('pubmed', 'openalex', 'crossref', 'chembl', 'uniprot', 'alphafold', 'user_upload', 'web');

-- CreateEnum
CREATE TYPE "HypothesisStatus" AS ENUM ('generated', 'clustered', 'debated', 'evolved', 'selected', 'rejected');

-- CreateEnum
CREATE TYPE "SupportType" AS ENUM ('supports', 'contradicts', 'mixed', 'background', 'unsupported');

-- CreateEnum
CREATE TYPE "SafetySeverity" AS ENUM ('low', 'medium', 'high', 'blocked');

-- CreateEnum
CREATE TYPE "SafetyCategory" AS ENUM ('biosecurity', 'chemical_safety', 'clinical_safety', 'dual_use', 'unsupported_claim', 'ethics', 'other');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "domain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "researchGoal" TEXT NOT NULL,
    "normalizedGoal" TEXT,
    "domain" TEXT,
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "sourceConfig" JSONB NOT NULL DEFAULT '{}',
    "modelConfig" JSONB NOT NULL DEFAULT '{}',
    "safetySensitivity" TEXT NOT NULL DEFAULT 'standard',
    "maxIterations" INTEGER NOT NULL DEFAULT 25,
    "maxRuntimeMinutes" INTEGER NOT NULL DEFAULT 180,
    "maxSources" INTEGER NOT NULL DEFAULT 100,
    "maxHypotheses" INTEGER NOT NULL DEFAULT 40,
    "maxModelCostUsd" DOUBLE PRECISION,
    "completionConfidence" DOUBLE PRECISION,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'active',
    "currentPhase" TEXT,
    "currentTaskId" TEXT,
    "iterationCount" INTEGER NOT NULL DEFAULT 0,
    "maxIterations" INTEGER NOT NULL DEFAULT 25,
    "tokenBudgetUsed" INTEGER,
    "costBudgetUsed" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "parentTaskId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "completionCriteria" JSONB NOT NULL DEFAULT '{}',
    "verificationCriteria" JSONB NOT NULL DEFAULT '{}',
    "verificationResult" JSONB,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "memoryType" "MemoryType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "payload" JSONB,
    "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCheckpoint" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "checkpointType" "CheckpointType" NOT NULL,
    "summary" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sessionId" TEXT,
    "taskId" TEXT,
    "agentName" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompletionAssessment" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "isComplete" BOOLEAN NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "missingWork" JSONB NOT NULL DEFAULT '[]',
    "blockers" JSONB NOT NULL DEFAULT '[]',
    "recommendedNextTasks" JSONB NOT NULL DEFAULT '[]',
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletionAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEval" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "evalType" "EvalType" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "authors" JSONB,
    "abstract" TEXT,
    "url" TEXT,
    "doi" TEXT,
    "pmid" TEXT,
    "year" INTEGER,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hypothesis" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "mechanism" TEXT NOT NULL,
    "noveltyRationale" TEXT NOT NULL,
    "testability" TEXT NOT NULL,
    "proposedExperimentHighLevel" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'low',
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "noveltyScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "feasibilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "impactScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" "HypothesisStatus" NOT NULL DEFAULT 'generated',
    "parentHypothesisIds" JSONB,
    "clusterId" TEXT,
    "createdByAgent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "hypothesisId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "claim" TEXT NOT NULL,
    "supportType" "SupportType" NOT NULL,
    "quote" TEXT,
    "explanation" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebateRound" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "hypothesisAId" TEXT NOT NULL,
    "hypothesisBId" TEXT NOT NULL,
    "judgeAgent" TEXT NOT NULL,
    "argumentA" TEXT NOT NULL,
    "argumentB" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "winnerHypothesisId" TEXT,
    "scoreDeltaA" DOUBLE PRECISION NOT NULL,
    "scoreDeltaB" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebateRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ranking" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "hypothesisId" TEXT NOT NULL,
    "eloScore" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "rank" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ranking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyFlag" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "hypothesisId" TEXT,
    "severity" "SafetySeverity" NOT NULL,
    "category" "SafetyCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalReport" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "executiveSummary" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "json" JSONB NOT NULL,
    "completionCriteriaPassed" BOOLEAN NOT NULL DEFAULT false,
    "completionConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unresolvedGaps" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinalReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sessionId" TEXT,
    "taskId" TEXT,
    "agentName" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sessionId" TEXT,
    "taskId" TEXT,
    "agentName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Project_userId_createdAt_idx" ON "Project"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRun_userId_createdAt_idx" ON "ResearchRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRun_projectId_createdAt_idx" ON "ResearchRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRun_status_idx" ON "ResearchRun"("status");

-- CreateIndex
CREATE INDEX "AgentSession_runId_createdAt_idx" ON "AgentSession"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentSession_status_lastHeartbeatAt_idx" ON "AgentSession"("status", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "AgentTask_sessionId_status_idx" ON "AgentTask"("sessionId", "status");

-- CreateIndex
CREATE INDEX "AgentTask_runId_agentName_idx" ON "AgentTask"("runId", "agentName");

-- CreateIndex
CREATE INDEX "AgentTask_runId_createdAt_idx" ON "AgentTask"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMemory_runId_memoryType_importanceScore_idx" ON "AgentMemory"("runId", "memoryType", "importanceScore");

-- CreateIndex
CREATE INDEX "AgentMemory_sessionId_createdAt_idx" ON "AgentMemory"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentCheckpoint_runId_createdAt_idx" ON "AgentCheckpoint"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentCheckpoint_sessionId_checkpointType_idx" ON "AgentCheckpoint"("sessionId", "checkpointType");

-- CreateIndex
CREATE INDEX "AgentEvent_runId_createdAt_idx" ON "AgentEvent"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvent_sessionId_createdAt_idx" ON "AgentEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "CompletionAssessment_runId_createdAt_idx" ON "CompletionAssessment"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEval_runId_evalType_idx" ON "AgentEval"("runId", "evalType");

-- CreateIndex
CREATE INDEX "SourceDocument_runId_sourceType_idx" ON "SourceDocument"("runId", "sourceType");

-- CreateIndex
CREATE INDEX "SourceDocument_runId_createdAt_idx" ON "SourceDocument"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "SourceDocument_doi_idx" ON "SourceDocument"("doi");

-- CreateIndex
CREATE INDEX "SourceDocument_pmid_idx" ON "SourceDocument"("pmid");

-- CreateIndex
CREATE INDEX "Hypothesis_runId_status_idx" ON "Hypothesis"("runId", "status");

-- CreateIndex
CREATE INDEX "Hypothesis_runId_overallScore_idx" ON "Hypothesis"("runId", "overallScore");

-- CreateIndex
CREATE INDEX "Hypothesis_clusterId_idx" ON "Hypothesis"("clusterId");

-- CreateIndex
CREATE INDEX "Evidence_runId_hypothesisId_idx" ON "Evidence"("runId", "hypothesisId");

-- CreateIndex
CREATE INDEX "Evidence_hypothesisId_supportType_idx" ON "Evidence"("hypothesisId", "supportType");

-- CreateIndex
CREATE INDEX "DebateRound_runId_createdAt_idx" ON "DebateRound"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "Ranking_runId_rank_idx" ON "Ranking"("runId", "rank");

-- CreateIndex
CREATE INDEX "Ranking_hypothesisId_idx" ON "Ranking"("hypothesisId");

-- CreateIndex
CREATE INDEX "SafetyFlag_runId_severity_idx" ON "SafetyFlag"("runId", "severity");

-- CreateIndex
CREATE INDEX "FinalReport_runId_createdAt_idx" ON "FinalReport"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolCall_runId_createdAt_idx" ON "ToolCall"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolCall_runId_toolName_idx" ON "ToolCall"("runId", "toolName");

-- CreateIndex
CREATE INDEX "ModelCall_runId_createdAt_idx" ON "ModelCall"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelCall_runId_provider_model_idx" ON "ModelCall"("runId", "provider", "model");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCheckpoint" ADD CONSTRAINT "AgentCheckpoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCheckpoint" ADD CONSTRAINT "AgentCheckpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletionAssessment" ADD CONSTRAINT "CompletionAssessment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletionAssessment" ADD CONSTRAINT "CompletionAssessment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEval" ADD CONSTRAINT "AgentEval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEval" ADD CONSTRAINT "AgentEval_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hypothesis" ADD CONSTRAINT "Hypothesis_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "Hypothesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebateRound" ADD CONSTRAINT "DebateRound_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebateRound" ADD CONSTRAINT "DebateRound_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebateRound" ADD CONSTRAINT "DebateRound_hypothesisAId_fkey" FOREIGN KEY ("hypothesisAId") REFERENCES "Hypothesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebateRound" ADD CONSTRAINT "DebateRound_hypothesisBId_fkey" FOREIGN KEY ("hypothesisBId") REFERENCES "Hypothesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ranking" ADD CONSTRAINT "Ranking_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ranking" ADD CONSTRAINT "Ranking_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "Hypothesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyFlag" ADD CONSTRAINT "SafetyFlag_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyFlag" ADD CONSTRAINT "SafetyFlag_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "Hypothesis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalReport" ADD CONSTRAINT "FinalReport_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelCall" ADD CONSTRAINT "ModelCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelCall" ADD CONSTRAINT "ModelCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelCall" ADD CONSTRAINT "ModelCall_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
