-- CreateTable
CREATE TABLE "AiSpendBudget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "maxCostPerDayCents" INTEGER,
    "maxCostPerMonthCents" INTEGER,
    "maxTokensPerDay" INTEGER,
    "usedCostTodayCents" INTEGER NOT NULL DEFAULT 0,
    "usedCostMonthCents" INTEGER NOT NULL DEFAULT 0,
    "usedTokensToday" INTEGER NOT NULL DEFAULT 0,
    "lastDailyResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMonthlyResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSpendBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSpendBudget_workspaceId_key" ON "AiSpendBudget"("workspaceId");

-- AddForeignKey
ALTER TABLE "AiSpendBudget" ADD CONSTRAINT "AiSpendBudget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

