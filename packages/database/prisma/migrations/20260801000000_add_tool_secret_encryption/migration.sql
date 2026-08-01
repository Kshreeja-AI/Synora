-- CreateEnum
CREATE TYPE "ToolSecretAuditAction" AS ENUM ('CREATED', 'RETRIEVED', 'UPDATED', 'ROTATED', 'DELETED', 'ACCESSED');

-- CreateTable
CREATE TABLE "ToolSecret" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "secretType" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'aes-256-gcm',
    "expiresAt" TIMESTAMP(3),
    "isRotationPending" BOOLEAN NOT NULL DEFAULT false,
    "lastRotatedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolSecretAuditLog" (
    "id" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "accessedBy" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolSecretAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ToolSecret_toolId_name_key" ON "ToolSecret"("toolId", "name");

-- CreateIndex
CREATE INDEX "ToolSecret_toolId_idx" ON "ToolSecret"("toolId");

-- CreateIndex
CREATE INDEX "ToolSecret_workspaceId_idx" ON "ToolSecret"("workspaceId");

-- CreateIndex
CREATE INDEX "ToolSecret_createdBy_idx" ON "ToolSecret"("createdBy");

-- CreateIndex
CREATE INDEX "ToolSecret_expiresAt_idx" ON "ToolSecret"("expiresAt");

-- CreateIndex
CREATE INDEX "ToolSecretAuditLog_secretId_idx" ON "ToolSecretAuditLog"("secretId");

-- CreateIndex
CREATE INDEX "ToolSecretAuditLog_workspaceId_idx" ON "ToolSecretAuditLog"("workspaceId");

-- CreateIndex
CREATE INDEX "ToolSecretAuditLog_accessedBy_idx" ON "ToolSecretAuditLog"("accessedBy");

-- CreateIndex
CREATE INDEX "ToolSecretAuditLog_action_idx" ON "ToolSecretAuditLog"("action");

-- CreateIndex
CREATE INDEX "ToolSecretAuditLog_createdAt_idx" ON "ToolSecretAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ToolSecret" ADD CONSTRAINT "ToolSecret_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ToolDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolSecret" ADD CONSTRAINT "ToolSecret_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolSecret" ADD CONSTRAINT "ToolSecret_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolSecretAuditLog" ADD CONSTRAINT "ToolSecretAuditLog_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "ToolSecret"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolSecretAuditLog" ADD CONSTRAINT "ToolSecretAuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolSecretAuditLog" ADD CONSTRAINT "ToolSecretAuditLog_accessedBy_fkey" FOREIGN KEY ("accessedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
