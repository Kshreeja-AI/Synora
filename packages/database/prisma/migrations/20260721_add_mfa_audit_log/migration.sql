-- CreateTable MFAAuditLog
CREATE TABLE "MFAAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MFAAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- CreateIndex
CREATE INDEX "MFAAuditLog_userId_timestamp_idx" ON "MFAAuditLog"("userId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "MFAAuditLog_action_timestamp_idx" ON "MFAAuditLog"("action", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "MFAAuditLog_timestamp_idx" ON "MFAAuditLog"("timestamp" DESC);
