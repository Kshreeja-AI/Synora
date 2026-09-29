-- AlterTable
ALTER TABLE "CommandExecution" ADD COLUMN     "undoKind" TEXT,
ADD COLUMN     "undoTargetId" TEXT,
ADD COLUMN     "undoneAt" TIMESTAMP(3),
ADD COLUMN     "undoneBy" TEXT;
