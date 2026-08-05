-- AlterTable
ALTER TABLE "CommandExecution" ADD COLUMN     "approvalExpiresAt" TIMESTAMP(3),
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedBy" TEXT,
ADD COLUMN     "rejectionReason" TEXT;
