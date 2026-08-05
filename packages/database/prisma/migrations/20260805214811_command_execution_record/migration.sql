-- CreateTable
CREATE TABLE "CommandExecution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commandText" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "capabilityId" TEXT,
    "riskClass" TEXT NOT NULL,
    "permitted" BOOLEAN NOT NULL,
    "available" BOOLEAN NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "approvalState" TEXT NOT NULL DEFAULT 'none',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "state" TEXT NOT NULL,
    "resultSummary" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CommandExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommandExecution_workspaceId_createdAt_idx" ON "CommandExecution"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CommandExecution_userId_idx" ON "CommandExecution"("userId");

-- CreateIndex
CREATE INDEX "CommandExecution_state_idx" ON "CommandExecution"("state");

-- AddForeignKey
ALTER TABLE "CommandExecution" ADD CONSTRAINT "CommandExecution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandExecution" ADD CONSTRAINT "CommandExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
