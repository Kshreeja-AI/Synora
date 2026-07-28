-- Release 3: Universal AI Workspace - Chat Foundation Schema

-- Conversation Folder model (must come first - referenced by Conversation)
CREATE TABLE "ConversationFolder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationFolder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE,
  CONSTRAINT "ConversationFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ConversationFolder" ("id") ON DELETE CASCADE,
  CONSTRAINT "ConversationFolder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- Core Conversation model
CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "folderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE,
  CONSTRAINT "Conversation_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ConversationFolder" ("id") ON DELETE SET NULL
);

-- Message model
CREATE TABLE "Message" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'user',
  "content" TEXT NOT NULL,
  "isStreaming" BOOLEAN NOT NULL DEFAULT false,
  "streamingJobId" TEXT,
  "tokensUsed" INTEGER,
  "editedContent" TEXT,
  "editedAt" TIMESTAMP(3),
  "parentMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE,
  CONSTRAINT "Message_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "Message" ("id") ON DELETE CASCADE
);

-- Message Branch model (for alternatives)
CREATE TABLE "MessageBranch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "messageId" TEXT NOT NULL UNIQUE,
  "branchIndex" INTEGER NOT NULL,
  "isMainBranch" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageBranch_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE
);

-- Message Attachment model
CREATE TABLE "MessageAttachment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "messageId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE
);

-- Conversation Tag model
CREATE TABLE "ConversationTag" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT DEFAULT '#6366f1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationTag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE
);

-- Conversation-Tag junction table
CREATE TABLE "_ConversationToConversationTag" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_ConversationToConversationTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Conversation" ("id") ON DELETE CASCADE,
  CONSTRAINT "_ConversationToConversationTag_B_fkey" FOREIGN KEY ("B") REFERENCES "ConversationTag" ("id") ON DELETE CASCADE
);

-- Prompt Template model
CREATE TABLE "PromptTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY,
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
  CONSTRAINT "PromptTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE
);

-- Conversation Template model
CREATE TABLE "ConversationTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "initialMessages" JSONB NOT NULL,
  "category" TEXT,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE
);

-- AI Memory model
CREATE TABLE "AIMemory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL UNIQUE,
  "context" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIMemory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE
);

-- Shared Conversation model
CREATE TABLE "SharedConversation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "shareToken" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3),
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "permissions" TEXT NOT NULL DEFAULT 'VIEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SharedConversation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE
);

-- Conversation Collaborator model
CREATE TABLE "ConversationCollaborator" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationCollaborator_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE
);

-- Conversation Activity model
CREATE TABLE "ConversationActivity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationActivity_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE
);

-- Conversation Version model
CREATE TABLE "ConversationVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationVersion_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE
);

-- Streaming Job model
CREATE TABLE "StreamingJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3)
);

-- Tool model
CREATE TABLE "Tool" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "definition" JSONB NOT NULL,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tool_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE
);

-- Tool Call model
CREATE TABLE "ToolCall" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "toolId" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "output" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ToolCall_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool" ("id") ON DELETE CASCADE
);

-- Conversation Usage model
CREATE TABLE "ConversationUsage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL UNIQUE,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationUsage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX "Conversation_workspaceId_createdAt_idx" ON "Conversation"("workspaceId", "createdAt");
CREATE INDEX "Conversation_folderId_idx" ON "Conversation"("folderId");
CREATE INDEX "Conversation_isArchived_idx" ON "Conversation"("isArchived");
CREATE INDEX "Conversation_isPinned_idx" ON "Conversation"("isPinned");
CREATE UNIQUE INDEX "Conversation_workspaceId_title_idx" ON "Conversation"("workspaceId", "title");

CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX "Message_parentMessageId_idx" ON "Message"("parentMessageId");

CREATE INDEX "MessageBranch_messageId_idx" ON "MessageBranch"("messageId");

CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

CREATE INDEX "ConversationFolder_workspaceId_idx" ON "ConversationFolder"("workspaceId");
CREATE INDEX "ConversationFolder_parentId_idx" ON "ConversationFolder"("parentId");
CREATE INDEX "ConversationFolder_createdById_idx" ON "ConversationFolder"("createdById");

CREATE INDEX "ConversationTag_workspaceId_idx" ON "ConversationTag"("workspaceId");
CREATE UNIQUE INDEX "ConversationTag_workspaceId_name_idx" ON "ConversationTag"("workspaceId", "name");

CREATE INDEX "_ConversationToConversationTag_A_idx" ON "_ConversationToConversationTag"("A");
CREATE INDEX "_ConversationToConversationTag_B_idx" ON "_ConversationToConversationTag"("B");

CREATE INDEX "PromptTemplate_workspaceId_idx" ON "PromptTemplate"("workspaceId");
CREATE INDEX "PromptTemplate_category_idx" ON "PromptTemplate"("category");

CREATE INDEX "ConversationTemplate_workspaceId_idx" ON "ConversationTemplate"("workspaceId");
CREATE INDEX "ConversationTemplate_category_idx" ON "ConversationTemplate"("category");

CREATE INDEX "AIMemory_workspaceId_idx" ON "AIMemory"("workspaceId");

CREATE INDEX "SharedConversation_shareToken_idx" ON "SharedConversation"("shareToken");
CREATE INDEX "SharedConversation_conversationId_idx" ON "SharedConversation"("conversationId");

CREATE INDEX "ConversationCollaborator_conversationId_idx" ON "ConversationCollaborator"("conversationId");
CREATE UNIQUE INDEX "ConversationCollaborator_conversationId_userId_idx" ON "ConversationCollaborator"("conversationId", "userId");

CREATE INDEX "ConversationActivity_conversationId_createdAt_idx" ON "ConversationActivity"("conversationId", "createdAt");

CREATE INDEX "ConversationVersion_conversationId_createdAt_idx" ON "ConversationVersion"("conversationId", "createdAt");

CREATE INDEX "StreamingJob_conversationId_idx" ON "StreamingJob"("conversationId");
CREATE INDEX "StreamingJob_status_idx" ON "StreamingJob"("status");

CREATE INDEX "Tool_workspaceId_idx" ON "Tool"("workspaceId");
CREATE UNIQUE INDEX "Tool_workspaceId_name_idx" ON "Tool"("workspaceId", "name");

CREATE INDEX "ToolCall_toolId_idx" ON "ToolCall"("toolId");

CREATE INDEX "ConversationUsage_conversationId_idx" ON "ConversationUsage"("conversationId");
