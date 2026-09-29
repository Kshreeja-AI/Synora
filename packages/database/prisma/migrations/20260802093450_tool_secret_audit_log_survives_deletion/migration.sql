-- DropForeignKey
ALTER TABLE "ToolSecretAuditLog" DROP CONSTRAINT "ToolSecretAuditLog_secretId_fkey";

-- AlterTable
ALTER TABLE "ToolSecretAuditLog" ALTER COLUMN "secretId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ToolSecretAuditLog" ADD CONSTRAINT "ToolSecretAuditLog_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "ToolSecret"("id") ON DELETE SET NULL ON UPDATE CASCADE;
