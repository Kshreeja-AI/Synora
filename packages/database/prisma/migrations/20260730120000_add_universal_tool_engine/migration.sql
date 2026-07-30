-- Universal Tool Calling Engine (Release 3)
-- Production-grade tool execution platform with streaming, retry, circuit breaker, sandboxing

-- Create ToolDefinition table (tool definitions and metadata)
CREATE TABLE "ToolDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    -- Schema & Validation
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB,

    -- Configuration
    "config" JSONB NOT NULL,
    "secrets" TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- Capabilities & Permissions
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "permission" TEXT NOT NULL DEFAULT 'PRIVATE',
    "allowedRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- Limits & Quotas
    "maxParallelCalls" INTEGER NOT NULL DEFAULT 10,
    "rateLimit" INTEGER,
    "timeout" INTEGER NOT NULL DEFAULT 30000,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,

    -- Flags
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAsync" BOOLEAN NOT NULL DEFAULT false,
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT false,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,

    -- Versioning & History
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,

    "createdBy" TEXT NOT NULL,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE,
    CONSTRAINT "ToolDefinition_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ToolDefinition" ("id") ON DELETE SET NULL,
    CONSTRAINT "ToolDefinition_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- Create ToolDependency table (tool dependencies)
CREATE TABLE "ToolDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "passOutputAs" TEXT,
    "transformOutput" TEXT,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolDependency_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "ToolDefinition" ("id") ON DELETE CASCADE,
    CONSTRAINT "ToolDependency_toId_fkey" FOREIGN KEY ("toId") REFERENCES "ToolDefinition" ("id") ON DELETE CASCADE,
    CONSTRAINT "ToolDependency_fromId_toId_key" UNIQUE ("fromId", "toId")
);

-- Create ToolExecution table (execution records)
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "toolId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT,
    "userId" TEXT NOT NULL,

    -- Execution details
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,

    -- Status & Progress
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,

    -- Streaming
    "isStreaming" BOOLEAN NOT NULL DEFAULT false,
    "streamStartedAt" TIMESTAMP(3),

    -- Retry tracking
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,

    -- Circuit breaker
    "circuitBreakerOpen" BOOLEAN NOT NULL DEFAULT false,

    -- Timing
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "duration" INTEGER,

    -- Cost tracking
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,

    -- Approval workflow
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolExecution_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ToolDefinition" ("id") ON DELETE CASCADE,
    CONSTRAINT "ToolExecution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE,
    CONSTRAINT "ToolExecution_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE,
    CONSTRAINT "ToolExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- Create ToolInvocation table (individual tool invocations)
CREATE TABLE "ToolInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "parentInvocationId" TEXT,

    -- Call details
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,

    -- Status
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    -- Timing
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    -- Order & Tracking
    "sequenceNumber" INTEGER NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolInvocation_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ToolExecution" ("id") ON DELETE CASCADE,
    CONSTRAINT "ToolInvocation_parentInvocationId_fkey" FOREIGN KEY ("parentInvocationId") REFERENCES "ToolInvocation" ("id") ON DELETE CASCADE
);

-- Create ToolAuditLog table (audit trail)
CREATE TABLE "ToolAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "toolId" TEXT NOT NULL,
    "executionId" TEXT,
    "userId" TEXT NOT NULL,

    "action" TEXT NOT NULL,
    "status" TEXT,
    "changes" JSONB,
    "metadata" JSONB,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolAuditLog_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ToolDefinition" ("id") ON DELETE CASCADE,
    CONSTRAINT "ToolAuditLog_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ToolExecution" ("id") ON DELETE CASCADE,
    CONSTRAINT "ToolAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- Create ToolMetrics table (aggregated statistics)
CREATE TABLE "ToolMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "toolId" TEXT NOT NULL UNIQUE,

    "totalExecutions" INTEGER NOT NULL DEFAULT 0,
    "successfulExecutions" INTEGER NOT NULL DEFAULT 0,
    "failedExecutions" INTEGER NOT NULL DEFAULT 0,

    "avgDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minDuration" INTEGER,
    "maxDuration" INTEGER,

    "avgInputTokens" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgOutputTokens" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCostCents" INTEGER NOT NULL DEFAULT 0,

    "lastExecutedAt" TIMESTAMP(3),

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolMetrics_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ToolDefinition" ("id") ON DELETE CASCADE
);

-- Create ToolWebhook table (webhook configurations)
CREATE TABLE "ToolWebhook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "toolId" TEXT NOT NULL,

    "event" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "headers" JSONB,

    "isActive" BOOLEAN NOT NULL DEFAULT true,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolWebhook_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ToolDefinition" ("id") ON DELETE CASCADE
);

-- Create ToolQuota table (workspace quotas)
CREATE TABLE "ToolQuota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL UNIQUE,

    -- Usage limits
    "maxToolsPerWorkspace" INTEGER NOT NULL DEFAULT 100,
    "maxExecutionsPerDay" INTEGER NOT NULL DEFAULT 10000,
    "maxCostPerMonth" INTEGER NOT NULL DEFAULT 100000,

    -- Current usage
    "executionsUsedToday" INTEGER NOT NULL DEFAULT 0,
    "costUsedThisMonth" INTEGER NOT NULL DEFAULT 0,

    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolQuota_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX "ToolDefinition_workspaceId_idx" ON "ToolDefinition"("workspaceId");
CREATE INDEX "ToolDefinition_category_idx" ON "ToolDefinition"("category");
CREATE INDEX "ToolDefinition_type_idx" ON "ToolDefinition"("type");
CREATE INDEX "ToolDefinition_isActive_idx" ON "ToolDefinition"("isActive");
CREATE INDEX "ToolDefinition_createdBy_idx" ON "ToolDefinition"("createdBy");
CREATE INDEX "ToolDefinition_workspaceId_name_idx" ON "ToolDefinition"("workspaceId", "name");

CREATE INDEX "ToolDependency_fromId_idx" ON "ToolDependency"("fromId");
CREATE INDEX "ToolDependency_toId_idx" ON "ToolDependency"("toId");

CREATE INDEX "ToolExecution_toolId_idx" ON "ToolExecution"("toolId");
CREATE INDEX "ToolExecution_workspaceId_idx" ON "ToolExecution"("workspaceId");
CREATE INDEX "ToolExecution_userId_idx" ON "ToolExecution"("userId");
CREATE INDEX "ToolExecution_conversationId_idx" ON "ToolExecution"("conversationId");
CREATE INDEX "ToolExecution_status_idx" ON "ToolExecution"("status");
CREATE INDEX "ToolExecution_createdAt_idx" ON "ToolExecution"("createdAt");
CREATE INDEX "ToolExecution_workspaceId_status_createdAt_idx" ON "ToolExecution"("workspaceId", "status", "createdAt");

CREATE INDEX "ToolInvocation_executionId_idx" ON "ToolInvocation"("executionId");
CREATE INDEX "ToolInvocation_parentInvocationId_idx" ON "ToolInvocation"("parentInvocationId");

CREATE INDEX "ToolAuditLog_toolId_idx" ON "ToolAuditLog"("toolId");
CREATE INDEX "ToolAuditLog_executionId_idx" ON "ToolAuditLog"("executionId");
CREATE INDEX "ToolAuditLog_userId_idx" ON "ToolAuditLog"("userId");
CREATE INDEX "ToolAuditLog_action_idx" ON "ToolAuditLog"("action");

CREATE INDEX "ToolMetrics_toolId_idx" ON "ToolMetrics"("toolId");

CREATE INDEX "ToolWebhook_toolId_idx" ON "ToolWebhook"("toolId");
CREATE INDEX "ToolWebhook_event_idx" ON "ToolWebhook"("event");

CREATE INDEX "ToolQuota_workspaceId_idx" ON "ToolQuota"("workspaceId");
