-- CreateTable
CREATE TABLE "ProjectVisit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectVisit_projectId_idx" ON "ProjectVisit"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectVisit_projectId_userId_key" ON "ProjectVisit"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "ProjectVisit" ADD CONSTRAINT "ProjectVisit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
