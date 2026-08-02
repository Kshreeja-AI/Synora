-- Reconciles accumulated schema drift: several prior feature commits (search
-- system, conversation file uploads, continuous learning platform tables,
-- tool engine enum cleanup) updated schema.prisma without ever generating a
-- migration. `prisma migrate deploy` therefore never created these types,
-- tables, or columns in any real database, so every query touching them
-- failed with "relation/column does not exist" once a real Postgres
-- instance became available to test against. Generated via
-- `prisma migrate diff --from-url <fully-migrated-db> --to-schema-datamodel
-- schema.prisma --script` and verified to leave zero remaining drift.

-- CreateEnum
CREATE TYPE "FileProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "VirusScanStatus" AS ENUM ('PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "SearchResourceType" AS ENUM ('CONVERSATION', 'MESSAGE', 'MEMORY', 'DOCUMENT', 'PROMPT_TEMPLATE', 'CONVERSATION_TEMPLATE');

-- CreateEnum
CREATE TYPE "SearchQueryType" AS ENUM ('HYBRID', 'FULLTEXT', 'VECTOR', 'SEMANTIC');

-- CreateEnum
CREATE TYPE "SearchSuggestionType" AS ENUM ('QUERY', 'KEYWORD', 'FILTER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "MessageFeedbackType" AS ENUM ('RATING', 'HELPFUL', 'UNHELPFUL', 'CORRECTION', 'HALLUCINATION', 'TOXICITY', 'BIAS', 'INCOMPLETE', 'IRRELEVANT');

-- CreateEnum
CREATE TYPE "CorrectionType" AS ENUM ('FACTUAL_ERROR', 'GRAMMAR', 'CLARITY', 'TONE', 'COMPLETENESS', 'STYLE', 'TECHNICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PreferenceType" AS ENUM ('ACCURACY', 'CLARITY', 'HELPFULNESS', 'RELEVANCE', 'STYLE', 'TONE', 'COMPLETENESS', 'SAFETY');

-- CreateEnum
CREATE TYPE "HallucinationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "HallucinationCategory" AS ENUM ('FACTUAL_ERROR', 'FALSE_CITATION', 'INVENTED_INFORMATION', 'OUTDATED_INFORMATION', 'LOGICAL_ERROR');

-- CreateEnum
CREATE TYPE "DatasetType" AS ENUM ('RLHF', 'DPO', 'SFT', 'TOOL_USE', 'REASONING', 'CODE_GENERATION', 'VISION', 'MULTIMODAL', 'EVALUATION', 'BENCHMARK');

-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('DRAFT', 'PROCESSING', 'READY', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "SampleSourceType" AS ENUM ('MESSAGE', 'CONVERSATION', 'FEEDBACK', 'CORRECTION', 'PREFERENCE', 'SYNTHETIC', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "SplitType" AS ENUM ('TRAIN', 'VALIDATION', 'TEST', 'HOLDOUT');

-- CreateEnum
CREATE TYPE "EvaluationType" AS ENUM ('ACCURACY', 'PERPLEXITY', 'BLEU', 'ROUGE', 'F1', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('THUMBS_UP', 'THUMBS_DOWN', 'RATING', 'PREFERENCE', 'CORRECTION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BenchmarkStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ModelVersionStatus" AS ENUM ('DRAFT', 'TRAINING', 'EVALUATING', 'RELEASED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('JSONL', 'PARQUET', 'HUGGINGFACE', 'CSV', 'JSON');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- DropForeignKey
ALTER TABLE "CreditLedgerEntry" DROP CONSTRAINT "CreditLedgerEntry_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "Memory" DROP CONSTRAINT "Memory_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "Memory" DROP CONSTRAINT "Memory_parentId_fkey";

-- DropForeignKey
ALTER TABLE "Memory" DROP CONSTRAINT "Memory_userId_fkey";

-- DropForeignKey
ALTER TABLE "Memory" DROP CONSTRAINT "Memory_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "MemoryAuditLog" DROP CONSTRAINT "MemoryAuditLog_memoryId_fkey";

-- DropForeignKey
ALTER TABLE "MemoryAuditLog" DROP CONSTRAINT "MemoryAuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "MemoryExport" DROP CONSTRAINT "MemoryExport_userId_fkey";

-- DropForeignKey
ALTER TABLE "MemoryExport" DROP CONSTRAINT "MemoryExport_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "MemoryMetadata" DROP CONSTRAINT "MemoryMetadata_memoryId_fkey";

-- DropForeignKey
ALTER TABLE "MemoryQuota" DROP CONSTRAINT "MemoryQuota_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "MemoryRelation" DROP CONSTRAINT "MemoryRelation_fromId_fkey";

-- DropForeignKey
ALTER TABLE "MemoryRelation" DROP CONSTRAINT "MemoryRelation_toId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentMethod" DROP CONSTRAINT "PaymentMethod_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentMethod" DROP CONSTRAINT "PaymentMethod_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_planId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "ToolAuditLog" DROP CONSTRAINT "ToolAuditLog_executionId_fkey";

-- DropForeignKey
ALTER TABLE "ToolAuditLog" DROP CONSTRAINT "ToolAuditLog_toolId_fkey";

-- DropForeignKey
ALTER TABLE "ToolAuditLog" DROP CONSTRAINT "ToolAuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "ToolDefinition" DROP CONSTRAINT "ToolDefinition_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "ToolDefinition" DROP CONSTRAINT "ToolDefinition_parentId_fkey";

-- DropForeignKey
ALTER TABLE "ToolDefinition" DROP CONSTRAINT "ToolDefinition_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "ToolDependency" DROP CONSTRAINT "ToolDependency_fromId_fkey";

-- DropForeignKey
ALTER TABLE "ToolDependency" DROP CONSTRAINT "ToolDependency_toId_fkey";

-- DropForeignKey
ALTER TABLE "ToolExecution" DROP CONSTRAINT "ToolExecution_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "ToolExecution" DROP CONSTRAINT "ToolExecution_toolId_fkey";

-- DropForeignKey
ALTER TABLE "ToolExecution" DROP CONSTRAINT "ToolExecution_userId_fkey";

-- DropForeignKey
ALTER TABLE "ToolExecution" DROP CONSTRAINT "ToolExecution_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "ToolInvocation" DROP CONSTRAINT "ToolInvocation_executionId_fkey";

-- DropForeignKey
ALTER TABLE "ToolInvocation" DROP CONSTRAINT "ToolInvocation_parentInvocationId_fkey";

-- DropForeignKey
ALTER TABLE "ToolMetrics" DROP CONSTRAINT "ToolMetrics_toolId_fkey";

-- DropForeignKey
ALTER TABLE "ToolQuota" DROP CONSTRAINT "ToolQuota_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "ToolWebhook" DROP CONSTRAINT "ToolWebhook_toolId_fkey";

-- DropForeignKey
ALTER TABLE "UsageRecord" DROP CONSTRAINT "UsageRecord_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "WorkspaceCredits" DROP CONSTRAINT "WorkspaceCredits_workspaceId_fkey";

-- DropIndex
DROP INDEX "ToolDefinition_workspaceId_name_idx";

-- DropIndex
DROP INDEX "ToolExecution_workspaceId_status_createdAt_idx";

-- DropEnum
DROP TYPE "ToolSecretAuditAction";

-- CreateTable
CREATE TABLE "ConversationFile" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 's3',
    "processingStatus" "FileProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processingError" TEXT,
    "processedAt" TIMESTAMP(3),
    "extractedText" TEXT,
    "virusScanStatus" "VirusScanStatus" NOT NULL DEFAULT 'PENDING',
    "virusScanError" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileProcessingJob" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "status" "FileProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchIndex" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceType" "SearchResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "totalChunks" INTEGER NOT NULL DEFAULT 1,
    "embeddingId" TEXT,
    "embeddingModel" TEXT,
    "embeddingDimension" INTEGER,
    "tsvector" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "isIndexed" BOOLEAN NOT NULL DEFAULT false,
    "indexedAt" TIMESTAMP(3),
    "lastUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchQuery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "queryType" "SearchQueryType" NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "executionTimeMs" INTEGER NOT NULL DEFAULT 0,
    "clickedResultId" TEXT,
    "clickPosition" INTEGER,
    "isRelevant" BOOLEAN,
    "sortBy" TEXT NOT NULL DEFAULT 'relevance',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "query" TEXT NOT NULL,
    "queryType" "SearchQueryType" NOT NULL DEFAULT 'HYBRID',
    "filters" JSONB,
    "sortBy" TEXT NOT NULL DEFAULT 'relevance',
    "limit" INTEGER NOT NULL DEFAULT 20,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedOrder" INTEGER,
    "executionCount" INTEGER NOT NULL DEFAULT 0,
    "lastExecutedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchSuggestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "type" "SearchSuggestionType" NOT NULL,
    "popularity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRanking" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceType" "SearchResourceType" NOT NULL,
    "titleWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "contentWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "keywordWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.2,
    "recencyWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "popularityWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "importanceWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.1,
    "boostRecent" BOOLEAN NOT NULL DEFAULT true,
    "recentDaysThreshold" INTEGER NOT NULL DEFAULT 7,
    "recentBoost" DOUBLE PRECISION NOT NULL DEFAULT 1.3,
    "boostByUserInteraction" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchRanking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchAnalytics" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "totalSearches" INTEGER NOT NULL DEFAULT 0,
    "uniqueSearchers" INTEGER NOT NULL DEFAULT 0,
    "avgExecutionTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgResultCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clickThroughRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "topQueries" JSONB NOT NULL,
    "topSearchers" JSONB NOT NULL,
    "indexSize" BIGINT NOT NULL DEFAULT 0,
    "cachedResultsHit" INTEGER NOT NULL DEFAULT 0,
    "cachedResultsMiss" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER,
    "isHelpful" BOOLEAN,
    "thumbsUp" BOOLEAN,
    "thumbsDown" BOOLEAN,
    "feedbackType" "MessageFeedbackType" NOT NULL,
    "comment" TEXT,
    "accuracyRating" INTEGER,
    "clarityRating" INTEGER,
    "completenessRating" INTEGER,
    "relevanceRating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationFeedback" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "overallRating" INTEGER,
    "isUseful" BOOLEAN,
    "qualityScore" INTEGER,
    "satisfactionScore" INTEGER,
    "comment" TEXT,
    "relevanceRating" INTEGER,
    "coherenceRating" INTEGER,
    "usefulnessRating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceFeedback" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRatings" INTEGER NOT NULL DEFAULT 0,
    "averageQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageSatisfactionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positiveCount" INTEGER NOT NULL DEFAULT 0,
    "neutralCount" INTEGER NOT NULL DEFAULT 0,
    "negativeCount" INTEGER NOT NULL DEFAULT 0,
    "topIssues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalContent" TEXT NOT NULL,
    "correctedContent" TEXT NOT NULL,
    "reason" TEXT,
    "correctionType" "CorrectionType" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Correction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferredResponse" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferredMessageId" TEXT NOT NULL,
    "rejectedMessageId" TEXT NOT NULL,
    "reason" TEXT,
    "preferenceType" "PreferenceType" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreferredResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallucinationReport" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hallucinatedText" TEXT NOT NULL,
    "factualCorrection" TEXT NOT NULL,
    "severity" "HallucinationSeverity" NOT NULL,
    "category" "HallucinationCategory" NOT NULL,
    "evidence" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HallucinationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitationFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "citedText" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "isAccurate" BOOLEAN,
    "isCitable" BOOLEAN,
    "qualityScore" INTEGER,
    "relevanceScore" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CitationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "isSuccessful" BOOLEAN,
    "isCorrect" BOOLEAN,
    "rating" INTEGER,
    "comment" TEXT,
    "errorDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisionFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "detectionAccuracy" INTEGER,
    "descriptionQuality" INTEGER,
    "relevance" INTEGER,
    "missedElements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "incorrectElements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transcriptionAccuracy" INTEGER,
    "synthesiQuality" INTEGER,
    "pronunciationQuality" INTEGER,
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "datasetType" "DatasetType" NOT NULL,
    "purpose" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "parentDatasetId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "status" "DatasetStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetVersion" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "versionName" TEXT,
    "changeLog" TEXT,
    "sampleCount" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetSample" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "datasetVersionId" TEXT,
    "sourceType" "SampleSourceType" NOT NULL,
    "sourceId" TEXT,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "qualityScore" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "isFiltered" BOOLEAN NOT NULL DEFAULT false,
    "filterReason" TEXT,
    "hasPII" BOOLEAN NOT NULL DEFAULT false,
    "isUnsafe" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetLabel" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "labelType" TEXT NOT NULL,
    "labelValue" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetSplit" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "splitType" "SplitType" NOT NULL,
    "splitPercentage" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DatasetSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "evaluationType" "EvaluationType" NOT NULL,
    "metrics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "EvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationResult" (
    "id" TEXT NOT NULL,
    "evaluationRunId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "prediction" TEXT NOT NULL,
    "groundTruth" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "metrics" JSONB,
    "error" TEXT,
    "errorType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardSignal" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reward" DOUBLE PRECISION NOT NULL,
    "rewardType" "RewardType" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanPreference" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "preferredSampleId" TEXT NOT NULL,
    "rejectedSampleId" TEXT NOT NULL,
    "annotatorId" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABExperiment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "controlModelId" TEXT NOT NULL,
    "treatmentModelId" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "targetSampleSize" INTEGER NOT NULL,
    "currentSampleSize" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ABExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABAssignment" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ABAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABResult" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "outcome" TEXT,
    "metricValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ABResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "datasetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "BenchmarkStatus" NOT NULL DEFAULT 'PENDING',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkMetric" (
    "id" TEXT NOT NULL,
    "benchmarkRunId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelRegistry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "description" TEXT,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "latestVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "versionString" TEXT NOT NULL,
    "trainingDatasetId" TEXT,
    "trainingProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "benchmarkScores" JSONB,
    "status" "ModelVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingCandidate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "hyperparameters" JSONB NOT NULL,
    "algorithm" TEXT NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingExport" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "fileSize" BIGINT,
    "fileUrl" TEXT,
    "checksum" TEXT,
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TrainingExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyConsent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collectFeedback" BOOLEAN NOT NULL DEFAULT false,
    "useForTraining" BOOLEAN NOT NULL DEFAULT false,
    "shareWithPartners" BOOLEAN NOT NULL DEFAULT false,
    "allowEvaluation" BOOLEAN NOT NULL DEFAULT false,
    "consentDocumentVersion" TEXT,
    "consentGivenAt" TIMESTAMP(3),
    "consentRevokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingConsent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "allowUseInTraining" BOOLEAN NOT NULL DEFAULT false,
    "allowUseInEvaluation" BOOLEAN NOT NULL DEFAULT false,
    "optOutReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackAnalytics" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalFeedback" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "unhelpfulCount" INTEGER NOT NULL DEFAULT 0,
    "feedbackByType" JSONB,
    "averageQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageSatisfaction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "topIssues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationFile_conversationId_idx" ON "ConversationFile"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationFile_workspaceId_idx" ON "ConversationFile"("workspaceId");

-- CreateIndex
CREATE INDEX "ConversationFile_uploadedBy_idx" ON "ConversationFile"("uploadedBy");

-- CreateIndex
CREATE INDEX "ConversationFile_processingStatus_idx" ON "ConversationFile"("processingStatus");

-- CreateIndex
CREATE INDEX "ConversationFile_virusScanStatus_idx" ON "ConversationFile"("virusScanStatus");

-- CreateIndex
CREATE UNIQUE INDEX "FileProcessingJob_fileId_key" ON "FileProcessingJob"("fileId");

-- CreateIndex
CREATE INDEX "FileProcessingJob_status_idx" ON "FileProcessingJob"("status");

-- CreateIndex
CREATE INDEX "FileProcessingJob_fileId_idx" ON "FileProcessingJob"("fileId");

-- CreateIndex
CREATE INDEX "SearchIndex_workspaceId_idx" ON "SearchIndex"("workspaceId");

-- CreateIndex
CREATE INDEX "SearchIndex_resourceType_idx" ON "SearchIndex"("resourceType");

-- CreateIndex
CREATE INDEX "SearchIndex_resourceId_idx" ON "SearchIndex"("resourceId");

-- CreateIndex
CREATE INDEX "SearchIndex_workspaceId_resourceType_resourceId_idx" ON "SearchIndex"("workspaceId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "SearchIndex_isIndexed_idx" ON "SearchIndex"("isIndexed");

-- CreateIndex
CREATE INDEX "SearchIndex_indexedAt_idx" ON "SearchIndex"("indexedAt");

-- CreateIndex
CREATE INDEX "SearchQuery_workspaceId_idx" ON "SearchQuery"("workspaceId");

-- CreateIndex
CREATE INDEX "SearchQuery_userId_idx" ON "SearchQuery"("userId");

-- CreateIndex
CREATE INDEX "SearchQuery_createdAt_idx" ON "SearchQuery"("createdAt");

-- CreateIndex
CREATE INDEX "SearchQuery_queryType_idx" ON "SearchQuery"("queryType");

-- CreateIndex
CREATE INDEX "SavedSearch_workspaceId_idx" ON "SavedSearch"("workspaceId");

-- CreateIndex
CREATE INDEX "SavedSearch_userId_idx" ON "SavedSearch"("userId");

-- CreateIndex
CREATE INDEX "SavedSearch_isPinned_idx" ON "SavedSearch"("isPinned");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_workspaceId_userId_name_key" ON "SavedSearch"("workspaceId", "userId", "name");

-- CreateIndex
CREATE INDEX "SearchSuggestion_workspaceId_idx" ON "SearchSuggestion"("workspaceId");

-- CreateIndex
CREATE INDEX "SearchSuggestion_frequency_idx" ON "SearchSuggestion"("frequency");

-- CreateIndex
CREATE INDEX "SearchSuggestion_popularity_idx" ON "SearchSuggestion"("popularity");

-- CreateIndex
CREATE UNIQUE INDEX "SearchSuggestion_workspaceId_term_key" ON "SearchSuggestion"("workspaceId", "term");

-- CreateIndex
CREATE INDEX "SearchRanking_workspaceId_idx" ON "SearchRanking"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchRanking_workspaceId_resourceType_key" ON "SearchRanking"("workspaceId", "resourceType");

-- CreateIndex
CREATE INDEX "SearchAnalytics_workspaceId_idx" ON "SearchAnalytics"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchAnalytics_workspaceId_periodStart_periodEnd_key" ON "SearchAnalytics"("workspaceId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "MessageFeedback_messageId_idx" ON "MessageFeedback"("messageId");

-- CreateIndex
CREATE INDEX "MessageFeedback_conversationId_idx" ON "MessageFeedback"("conversationId");

-- CreateIndex
CREATE INDEX "MessageFeedback_workspaceId_idx" ON "MessageFeedback"("workspaceId");

-- CreateIndex
CREATE INDEX "MessageFeedback_userId_idx" ON "MessageFeedback"("userId");

-- CreateIndex
CREATE INDEX "MessageFeedback_feedbackType_idx" ON "MessageFeedback"("feedbackType");

-- CreateIndex
CREATE INDEX "MessageFeedback_createdAt_idx" ON "MessageFeedback"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageFeedback_messageId_userId_key" ON "MessageFeedback"("messageId", "userId");

-- CreateIndex
CREATE INDEX "ConversationFeedback_conversationId_idx" ON "ConversationFeedback"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationFeedback_workspaceId_idx" ON "ConversationFeedback"("workspaceId");

-- CreateIndex
CREATE INDEX "ConversationFeedback_userId_idx" ON "ConversationFeedback"("userId");

-- CreateIndex
CREATE INDEX "ConversationFeedback_createdAt_idx" ON "ConversationFeedback"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationFeedback_conversationId_userId_key" ON "ConversationFeedback"("conversationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceFeedback_workspaceId_key" ON "WorkspaceFeedback"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceFeedback_workspaceId_idx" ON "WorkspaceFeedback"("workspaceId");

-- CreateIndex
CREATE INDEX "Correction_messageId_idx" ON "Correction"("messageId");

-- CreateIndex
CREATE INDEX "Correction_conversationId_idx" ON "Correction"("conversationId");

-- CreateIndex
CREATE INDEX "Correction_workspaceId_idx" ON "Correction"("workspaceId");

-- CreateIndex
CREATE INDEX "Correction_correctionType_idx" ON "Correction"("correctionType");

-- CreateIndex
CREATE INDEX "PreferredResponse_conversationId_idx" ON "PreferredResponse"("conversationId");

-- CreateIndex
CREATE INDEX "PreferredResponse_workspaceId_idx" ON "PreferredResponse"("workspaceId");

-- CreateIndex
CREATE INDEX "PreferredResponse_preferenceType_idx" ON "PreferredResponse"("preferenceType");

-- CreateIndex
CREATE INDEX "HallucinationReport_messageId_idx" ON "HallucinationReport"("messageId");

-- CreateIndex
CREATE INDEX "HallucinationReport_conversationId_idx" ON "HallucinationReport"("conversationId");

-- CreateIndex
CREATE INDEX "HallucinationReport_severity_idx" ON "HallucinationReport"("severity");

-- CreateIndex
CREATE INDEX "HallucinationReport_category_idx" ON "HallucinationReport"("category");

-- CreateIndex
CREATE INDEX "CitationFeedback_messageId_idx" ON "CitationFeedback"("messageId");

-- CreateIndex
CREATE INDEX "CitationFeedback_conversationId_idx" ON "CitationFeedback"("conversationId");

-- CreateIndex
CREATE INDEX "CitationFeedback_isAccurate_idx" ON "CitationFeedback"("isAccurate");

-- CreateIndex
CREATE INDEX "ToolFeedback_messageId_idx" ON "ToolFeedback"("messageId");

-- CreateIndex
CREATE INDEX "ToolFeedback_conversationId_idx" ON "ToolFeedback"("conversationId");

-- CreateIndex
CREATE INDEX "ToolFeedback_toolId_idx" ON "ToolFeedback"("toolId");

-- CreateIndex
CREATE INDEX "VisionFeedback_messageId_idx" ON "VisionFeedback"("messageId");

-- CreateIndex
CREATE INDEX "VisionFeedback_conversationId_idx" ON "VisionFeedback"("conversationId");

-- CreateIndex
CREATE INDEX "VoiceFeedback_messageId_idx" ON "VoiceFeedback"("messageId");

-- CreateIndex
CREATE INDEX "VoiceFeedback_conversationId_idx" ON "VoiceFeedback"("conversationId");

-- CreateIndex
CREATE INDEX "Dataset_workspaceId_idx" ON "Dataset"("workspaceId");

-- CreateIndex
CREATE INDEX "Dataset_datasetType_idx" ON "Dataset"("datasetType");

-- CreateIndex
CREATE INDEX "Dataset_status_idx" ON "Dataset"("status");

-- CreateIndex
CREATE INDEX "Dataset_createdBy_idx" ON "Dataset"("createdBy");

-- CreateIndex
CREATE INDEX "DatasetVersion_datasetId_idx" ON "DatasetVersion"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetVersion_datasetId_versionNumber_key" ON "DatasetVersion"("datasetId", "versionNumber");

-- CreateIndex
CREATE INDEX "DatasetSample_datasetId_idx" ON "DatasetSample"("datasetId");

-- CreateIndex
CREATE INDEX "DatasetSample_sourceType_idx" ON "DatasetSample"("sourceType");

-- CreateIndex
CREATE INDEX "DatasetSample_qualityScore_idx" ON "DatasetSample"("qualityScore");

-- CreateIndex
CREATE INDEX "DatasetSample_hasPII_idx" ON "DatasetSample"("hasPII");

-- CreateIndex
CREATE INDEX "DatasetLabel_sampleId_idx" ON "DatasetLabel"("sampleId");

-- CreateIndex
CREATE INDEX "DatasetLabel_labelType_idx" ON "DatasetLabel"("labelType");

-- CreateIndex
CREATE INDEX "DatasetSplit_sampleId_idx" ON "DatasetSplit"("sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetSplit_sampleId_splitType_key" ON "DatasetSplit"("sampleId", "splitType");

-- CreateIndex
CREATE INDEX "EvaluationRun_workspaceId_idx" ON "EvaluationRun"("workspaceId");

-- CreateIndex
CREATE INDEX "EvaluationRun_datasetId_idx" ON "EvaluationRun"("datasetId");

-- CreateIndex
CREATE INDEX "EvaluationRun_status_idx" ON "EvaluationRun"("status");

-- CreateIndex
CREATE INDEX "EvaluationResult_evaluationRunId_idx" ON "EvaluationResult"("evaluationRunId");

-- CreateIndex
CREATE INDEX "EvaluationResult_score_idx" ON "EvaluationResult"("score");

-- CreateIndex
CREATE INDEX "RewardSignal_conversationId_idx" ON "RewardSignal"("conversationId");

-- CreateIndex
CREATE INDEX "RewardSignal_messageId_idx" ON "RewardSignal"("messageId");

-- CreateIndex
CREATE INDEX "RewardSignal_rewardType_idx" ON "RewardSignal"("rewardType");

-- CreateIndex
CREATE INDEX "HumanPreference_datasetId_idx" ON "HumanPreference"("datasetId");

-- CreateIndex
CREATE INDEX "HumanPreference_workspaceId_idx" ON "HumanPreference"("workspaceId");

-- CreateIndex
CREATE INDEX "ABExperiment_workspaceId_idx" ON "ABExperiment"("workspaceId");

-- CreateIndex
CREATE INDEX "ABExperiment_status_idx" ON "ABExperiment"("status");

-- CreateIndex
CREATE INDEX "ABAssignment_experimentId_idx" ON "ABAssignment"("experimentId");

-- CreateIndex
CREATE INDEX "ABAssignment_variant_idx" ON "ABAssignment"("variant");

-- CreateIndex
CREATE UNIQUE INDEX "ABAssignment_experimentId_conversationId_key" ON "ABAssignment"("experimentId", "conversationId");

-- CreateIndex
CREATE INDEX "ABResult_experimentId_idx" ON "ABResult"("experimentId");

-- CreateIndex
CREATE INDEX "BenchmarkRun_workspaceId_idx" ON "BenchmarkRun"("workspaceId");

-- CreateIndex
CREATE INDEX "BenchmarkRun_status_idx" ON "BenchmarkRun"("status");

-- CreateIndex
CREATE INDEX "BenchmarkMetric_benchmarkRunId_idx" ON "BenchmarkMetric"("benchmarkRunId");

-- CreateIndex
CREATE INDEX "BenchmarkMetric_modelId_idx" ON "BenchmarkMetric"("modelId");

-- CreateIndex
CREATE INDEX "BenchmarkMetric_datasetId_idx" ON "BenchmarkMetric"("datasetId");

-- CreateIndex
CREATE INDEX "ModelRegistry_workspaceId_idx" ON "ModelRegistry"("workspaceId");

-- CreateIndex
CREATE INDEX "ModelRegistry_providerId_idx" ON "ModelRegistry"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelRegistry_workspaceId_providerId_modelName_key" ON "ModelRegistry"("workspaceId", "providerId", "modelName");

-- CreateIndex
CREATE INDEX "ModelVersion_modelId_idx" ON "ModelVersion"("modelId");

-- CreateIndex
CREATE INDEX "ModelVersion_status_idx" ON "ModelVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_modelId_versionString_key" ON "ModelVersion"("modelId", "versionString");

-- CreateIndex
CREATE INDEX "TrainingCandidate_workspaceId_idx" ON "TrainingCandidate"("workspaceId");

-- CreateIndex
CREATE INDEX "TrainingCandidate_status_idx" ON "TrainingCandidate"("status");

-- CreateIndex
CREATE INDEX "TrainingCandidate_priority_idx" ON "TrainingCandidate"("priority");

-- CreateIndex
CREATE INDEX "TrainingExport_datasetId_idx" ON "TrainingExport"("datasetId");

-- CreateIndex
CREATE INDEX "TrainingExport_status_idx" ON "TrainingExport"("status");

-- CreateIndex
CREATE INDEX "PrivacyConsent_workspaceId_idx" ON "PrivacyConsent"("workspaceId");

-- CreateIndex
CREATE INDEX "PrivacyConsent_userId_idx" ON "PrivacyConsent"("userId");

-- CreateIndex
CREATE INDEX "PrivacyConsent_collectFeedback_idx" ON "PrivacyConsent"("collectFeedback");

-- CreateIndex
CREATE INDEX "PrivacyConsent_useForTraining_idx" ON "PrivacyConsent"("useForTraining");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyConsent_workspaceId_userId_key" ON "PrivacyConsent"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "TrainingConsent_workspaceId_idx" ON "TrainingConsent"("workspaceId");

-- CreateIndex
CREATE INDEX "TrainingConsent_allowUseInTraining_idx" ON "TrainingConsent"("allowUseInTraining");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingConsent_conversationId_userId_key" ON "TrainingConsent"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "FeedbackAnalytics_workspaceId_idx" ON "FeedbackAnalytics"("workspaceId");

-- CreateIndex
CREATE INDEX "FeedbackAnalytics_periodStart_idx" ON "FeedbackAnalytics"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackAnalytics_workspaceId_periodStart_periodEnd_key" ON "FeedbackAnalytics"("workspaceId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "ToolDefinition_workspaceId_name_key" ON "ToolDefinition"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceCredits" ADD CONSTRAINT "WorkspaceCredits_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFile" ADD CONSTRAINT "ConversationFile_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFile" ADD CONSTRAINT "ConversationFile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFile" ADD CONSTRAINT "ConversationFile_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileProcessingJob" ADD CONSTRAINT "FileProcessingJob_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ConversationFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Memory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryMetadata" ADD CONSTRAINT "MemoryMetadata_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryRelation" ADD CONSTRAINT "MemoryRelation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryRelation" ADD CONSTRAINT "MemoryRelation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryAuditLog" ADD CONSTRAINT "MemoryAuditLog_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryAuditLog" ADD CONSTRAINT "MemoryAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryQuota" ADD CONSTRAINT "MemoryQuota_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryExport" ADD CONSTRAINT "MemoryExport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryExport" ADD CONSTRAINT "MemoryExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolDefinition" ADD CONSTRAINT "ToolDefinition_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ToolDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolDefinition" ADD CONSTRAINT "ToolDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolDefinition" ADD CONSTRAINT "ToolDefinition_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolDependency" ADD CONSTRAINT "ToolDependency_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "ToolDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolDependency" ADD CONSTRAINT "ToolDependency_toId_fkey" FOREIGN KEY ("toId") REFERENCES "ToolDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ToolDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolInvocation" ADD CONSTRAINT "ToolInvocation_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ToolExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolInvocation" ADD CONSTRAINT "ToolInvocation_parentInvocationId_fkey" FOREIGN KEY ("parentInvocationId") REFERENCES "ToolInvocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolAuditLog" ADD CONSTRAINT "ToolAuditLog_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ToolDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolAuditLog" ADD CONSTRAINT "ToolAuditLog_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ToolExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolAuditLog" ADD CONSTRAINT "ToolAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolMetrics" ADD CONSTRAINT "ToolMetrics_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ToolDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolWebhook" ADD CONSTRAINT "ToolWebhook_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ToolDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolQuota" ADD CONSTRAINT "ToolQuota_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchIndex" ADD CONSTRAINT "SearchIndex_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchQuery" ADD CONSTRAINT "SearchQuery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchQuery" ADD CONSTRAINT "SearchQuery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchSuggestion" ADD CONSTRAINT "SearchSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRanking" ADD CONSTRAINT "SearchRanking_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchAnalytics" ADD CONSTRAINT "SearchAnalytics_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageFeedback" ADD CONSTRAINT "MessageFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageFeedback" ADD CONSTRAINT "MessageFeedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageFeedback" ADD CONSTRAINT "MessageFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageFeedback" ADD CONSTRAINT "MessageFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFeedback" ADD CONSTRAINT "ConversationFeedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFeedback" ADD CONSTRAINT "ConversationFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFeedback" ADD CONSTRAINT "ConversationFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceFeedback" ADD CONSTRAINT "WorkspaceFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferredResponse" ADD CONSTRAINT "PreferredResponse_preferredMessageId_fkey" FOREIGN KEY ("preferredMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferredResponse" ADD CONSTRAINT "PreferredResponse_rejectedMessageId_fkey" FOREIGN KEY ("rejectedMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferredResponse" ADD CONSTRAINT "PreferredResponse_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferredResponse" ADD CONSTRAINT "PreferredResponse_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferredResponse" ADD CONSTRAINT "PreferredResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallucinationReport" ADD CONSTRAINT "HallucinationReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallucinationReport" ADD CONSTRAINT "HallucinationReport_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallucinationReport" ADD CONSTRAINT "HallucinationReport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallucinationReport" ADD CONSTRAINT "HallucinationReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationFeedback" ADD CONSTRAINT "CitationFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationFeedback" ADD CONSTRAINT "CitationFeedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationFeedback" ADD CONSTRAINT "CitationFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationFeedback" ADD CONSTRAINT "CitationFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolFeedback" ADD CONSTRAINT "ToolFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolFeedback" ADD CONSTRAINT "ToolFeedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolFeedback" ADD CONSTRAINT "ToolFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolFeedback" ADD CONSTRAINT "ToolFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolFeedback" ADD CONSTRAINT "ToolFeedback_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ToolDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisionFeedback" ADD CONSTRAINT "VisionFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisionFeedback" ADD CONSTRAINT "VisionFeedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisionFeedback" ADD CONSTRAINT "VisionFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisionFeedback" ADD CONSTRAINT "VisionFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceFeedback" ADD CONSTRAINT "VoiceFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceFeedback" ADD CONSTRAINT "VoiceFeedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceFeedback" ADD CONSTRAINT "VoiceFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceFeedback" ADD CONSTRAINT "VoiceFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_parentDatasetId_fkey" FOREIGN KEY ("parentDatasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetSample" ADD CONSTRAINT "DatasetSample_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetSample" ADD CONSTRAINT "DatasetSample_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetLabel" ADD CONSTRAINT "DatasetLabel_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "DatasetSample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetSplit" ADD CONSTRAINT "DatasetSplit_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "DatasetSample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "EvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardSignal" ADD CONSTRAINT "RewardSignal_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardSignal" ADD CONSTRAINT "RewardSignal_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardSignal" ADD CONSTRAINT "RewardSignal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardSignal" ADD CONSTRAINT "RewardSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanPreference" ADD CONSTRAINT "HumanPreference_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanPreference" ADD CONSTRAINT "HumanPreference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ABExperiment" ADD CONSTRAINT "ABExperiment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ABAssignment" ADD CONSTRAINT "ABAssignment_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ABExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ABAssignment" ADD CONSTRAINT "ABAssignment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ABAssignment" ADD CONSTRAINT "ABAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ABAssignment" ADD CONSTRAINT "ABAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ABResult" ADD CONSTRAINT "ABResult_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ABExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ABResult" ADD CONSTRAINT "ABResult_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkMetric" ADD CONSTRAINT "BenchmarkMetric_benchmarkRunId_fkey" FOREIGN KEY ("benchmarkRunId") REFERENCES "BenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelRegistry" ADD CONSTRAINT "ModelRegistry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCandidate" ADD CONSTRAINT "TrainingCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCandidate" ADD CONSTRAINT "TrainingCandidate_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingExport" ADD CONSTRAINT "TrainingExport_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingExport" ADD CONSTRAINT "TrainingExport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyConsent" ADD CONSTRAINT "PrivacyConsent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyConsent" ADD CONSTRAINT "PrivacyConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingConsent" ADD CONSTRAINT "TrainingConsent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingConsent" ADD CONSTRAINT "TrainingConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingConsent" ADD CONSTRAINT "TrainingConsent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackAnalytics" ADD CONSTRAINT "FeedbackAnalytics_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

