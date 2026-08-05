-- CreateTable
CREATE TABLE "WorkspaceVisit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceVisit_workspaceId_idx" ON "WorkspaceVisit"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceVisit_workspaceId_userId_key" ON "WorkspaceVisit"("workspaceId", "userId");

-- AddForeignKey
ALTER TABLE "WorkspaceVisit" ADD CONSTRAINT "WorkspaceVisit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
