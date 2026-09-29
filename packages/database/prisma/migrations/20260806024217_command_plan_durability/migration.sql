-- AlterTable
ALTER TABLE "CommandExecution" ADD COLUMN     "planId" TEXT,
ADD COLUMN     "planStepIndex" INTEGER;

-- CreateTable
CREATE TABLE "CommandPlan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stoppedAtStep" INTEGER,
    "stoppedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CommandPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandPlanStep" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "capabilityId" TEXT,
    "riskClass" TEXT NOT NULL,
    "permitted" BOOLEAN NOT NULL,
    "dependsOn" INTEGER[],
    "state" TEXT NOT NULL,
    "resultSummary" TEXT,
    "failureReason" TEXT,
    "executionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CommandPlanStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommandPlan_workspaceId_createdAt_idx" ON "CommandPlan"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CommandPlan_userId_idx" ON "CommandPlan"("userId");

-- CreateIndex
CREATE INDEX "CommandPlan_status_idx" ON "CommandPlan"("status");

-- CreateIndex
CREATE INDEX "CommandPlanStep_planId_idx" ON "CommandPlanStep"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "CommandPlanStep_planId_index_key" ON "CommandPlanStep"("planId", "index");

-- CreateIndex
CREATE INDEX "CommandExecution_planId_idx" ON "CommandExecution"("planId");

-- AddForeignKey
ALTER TABLE "CommandPlan" ADD CONSTRAINT "CommandPlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandPlan" ADD CONSTRAINT "CommandPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandPlanStep" ADD CONSTRAINT "CommandPlanStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CommandPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
