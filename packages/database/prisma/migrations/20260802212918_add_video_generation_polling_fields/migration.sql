-- AlterTable
ALTER TABLE "GeneratedVideo" ADD COLUMN     "pollAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "providerJobId" TEXT;
