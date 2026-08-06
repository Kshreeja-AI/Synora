-- AlterTable
ALTER TABLE "CommandExecution" ADD COLUMN     "clarificationQuestion" TEXT,
ADD COLUMN     "confidence" TEXT,
ADD COLUMN     "latencyMs" INTEGER,
ADD COLUMN     "trainingEligibleAtCapture" BOOLEAN NOT NULL DEFAULT false;
