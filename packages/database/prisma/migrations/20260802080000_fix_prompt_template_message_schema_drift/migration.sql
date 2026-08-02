-- Reconciles schema drift: schema.prisma was updated for the pin/unpin
-- message feature and the prompt/template library feature, but no migration
-- was generated for either change. `prisma migrate deploy` never created
-- these columns, so every insert/select touching them fails with
-- "column does not exist" once a real Postgres instance is available to run
-- against (masked locally where the test DB is unreachable entirely).

-- Message: pin/unpin support
ALTER TABLE "Message" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Message_conversationId_isPinned_idx" ON "Message"("conversationId", "isPinned");

-- PromptTemplate: description, versioning, ownership, rating
ALTER TABLE "PromptTemplate" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "PromptTemplate" ADD COLUMN "description" TEXT;
ALTER TABLE "PromptTemplate" ADD COLUMN "rating" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PromptTemplate" ADD COLUMN "parentId" TEXT;
ALTER TABLE "PromptTemplate" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PromptTemplate" ADD COLUMN "createdBy" TEXT NOT NULL;

CREATE INDEX "PromptTemplate_createdBy_idx" ON "PromptTemplate"("createdBy");
CREATE INDEX "PromptTemplate_category_idx" ON "PromptTemplate"("category");

ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PromptTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ConversationTemplate: replace initialMessages (JSONB) with
-- systemPrompt/initialUserMessage/suggestedFollowUps, add ownership
ALTER TABLE "ConversationTemplate" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "ConversationTemplate" ADD COLUMN "systemPrompt" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ConversationTemplate" ALTER COLUMN "systemPrompt" DROP DEFAULT;
ALTER TABLE "ConversationTemplate" ADD COLUMN "initialUserMessage" TEXT;
ALTER TABLE "ConversationTemplate" ADD COLUMN "suggestedFollowUps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ConversationTemplate" ALTER COLUMN "suggestedFollowUps" DROP DEFAULT;
ALTER TABLE "ConversationTemplate" DROP COLUMN "initialMessages";
ALTER TABLE "ConversationTemplate" ADD COLUMN "createdBy" TEXT NOT NULL;

CREATE INDEX "ConversationTemplate_createdBy_idx" ON "ConversationTemplate"("createdBy");
CREATE INDEX "ConversationTemplate_category_idx" ON "ConversationTemplate"("category");

ALTER TABLE "ConversationTemplate" ADD CONSTRAINT "ConversationTemplate_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
