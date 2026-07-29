-- Release 3: Universal AI Workspace - Chat Foundation Schema
-- Generated from prisma/schema.prisma via `prisma migrate diff`.
-- Do not hand-edit; regenerate if the schema changes.

-- Enum types
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
CREATE TYPE "SharePermission" AS ENUM ('VIEW', 'COMMENT', 'EDIT');
CREATE TYPE "CollaboratorRole" AS ENUM ('VIEWER', 'EDITOR', 'OWNER');
CREATE TYPE "StreamingJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');

-- Tables
CREATE TABLE "ConversationFolder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationFolder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "folderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "parentId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageBranch" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "branchIndex" INTEGER NOT NULL,
    "isMainBranch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageBranch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationTag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT[],
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "initialMessages" JSONB NOT NULL,
    "category" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIMemory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SharedConversation" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "permissions" "SharePermission" NOT NULL DEFAULT 'VIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationCollaborator" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CollaboratorRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationCollaborator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationActivity" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationVersion" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StreamingJob" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "StreamingJobStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StreamingJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tool" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "executedBy" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationUsage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "_ConversationToConversationTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- Indexes
CREATE INDEX "Conversation_workspaceId_idx" ON "Conversation"("workspaceId");
CREATE INDEX "Conversation_workspaceId_createdAt_idx" ON "Conversation"("workspaceId", "createdAt");
CREATE INDEX "Conversation_isArchived_idx" ON "Conversation"("isArchived");
CREATE INDEX "Conversation_isPinned_idx" ON "Conversation"("isPinned");
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Message_conversationId_deletedAt_idx" ON "Message"("conversationId", "deletedAt");
CREATE INDEX "Message_parentId_idx" ON "Message"("parentId");
CREATE UNIQUE INDEX "MessageBranch_messageId_key" ON "MessageBranch"("messageId");
CREATE INDEX "MessageBranch_messageId_idx" ON "MessageBranch"("messageId");
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");
CREATE INDEX "ConversationFolder_workspaceId_idx" ON "ConversationFolder"("workspaceId");
CREATE INDEX "ConversationFolder_parentId_idx" ON "ConversationFolder"("parentId");
CREATE INDEX "ConversationFolder_createdById_idx" ON "ConversationFolder"("createdById");
CREATE INDEX "ConversationTag_workspaceId_idx" ON "ConversationTag"("workspaceId");
CREATE UNIQUE INDEX "ConversationTag_workspaceId_name_key" ON "ConversationTag"("workspaceId", "name");
CREATE INDEX "PromptTemplate_workspaceId_idx" ON "PromptTemplate"("workspaceId");
CREATE INDEX "PromptTemplate_isPublic_idx" ON "PromptTemplate"("isPublic");
CREATE INDEX "ConversationTemplate_workspaceId_idx" ON "ConversationTemplate"("workspaceId");
CREATE INDEX "ConversationTemplate_isPublic_idx" ON "ConversationTemplate"("isPublic");
CREATE UNIQUE INDEX "AIMemory_workspaceId_key" ON "AIMemory"("workspaceId");
CREATE UNIQUE INDEX "SharedConversation_shareToken_key" ON "SharedConversation"("shareToken");
CREATE INDEX "SharedConversation_conversationId_idx" ON "SharedConversation"("conversationId");
CREATE INDEX "SharedConversation_shareToken_idx" ON "SharedConversation"("shareToken");
CREATE INDEX "ConversationCollaborator_conversationId_idx" ON "ConversationCollaborator"("conversationId");
CREATE UNIQUE INDEX "ConversationCollaborator_conversationId_userId_key" ON "ConversationCollaborator"("conversationId", "userId");
CREATE INDEX "ConversationActivity_conversationId_createdAt_idx" ON "ConversationActivity"("conversationId", "createdAt");
CREATE INDEX "ConversationVersion_conversationId_createdAt_idx" ON "ConversationVersion"("conversationId", "createdAt");
CREATE INDEX "StreamingJob_conversationId_idx" ON "StreamingJob"("conversationId");
CREATE INDEX "StreamingJob_status_idx" ON "StreamingJob"("status");
CREATE INDEX "Tool_workspaceId_idx" ON "Tool"("workspaceId");
CREATE INDEX "Tool_isPublic_idx" ON "Tool"("isPublic");
CREATE INDEX "ToolCall_toolId_idx" ON "ToolCall"("toolId");
CREATE INDEX "ToolCall_conversationId_idx" ON "ToolCall"("conversationId");
CREATE UNIQUE INDEX "ConversationUsage_conversationId_key" ON "ConversationUsage"("conversationId");
CREATE UNIQUE INDEX "_ConversationToConversationTag_AB_unique" ON "_ConversationToConversationTag"("A", "B");
CREATE INDEX "_ConversationToConversationTag_B_index" ON "_ConversationToConversationTag"("B");

-- Foreign keys
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ConversationFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageBranch" ADD CONSTRAINT "MessageBranch_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationFolder" ADD CONSTRAINT "ConversationFolder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationFolder" ADD CONSTRAINT "ConversationFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ConversationFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationFolder" ADD CONSTRAINT "ConversationFolder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationTag" ADD CONSTRAINT "ConversationTag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationTemplate" ADD CONSTRAINT "ConversationTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIMemory" ADD CONSTRAINT "AIMemory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SharedConversation" ADD CONSTRAINT "SharedConversation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationCollaborator" ADD CONSTRAINT "ConversationCollaborator_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationActivity" ADD CONSTRAINT "ConversationActivity_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationVersion" ADD CONSTRAINT "ConversationVersion_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tool" ADD CONSTRAINT "Tool_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationUsage" ADD CONSTRAINT "ConversationUsage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ConversationToConversationTag" ADD CONSTRAINT "_ConversationToConversationTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ConversationToConversationTag" ADD CONSTRAINT "_ConversationToConversationTag_B_fkey" FOREIGN KEY ("B") REFERENCES "ConversationTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

