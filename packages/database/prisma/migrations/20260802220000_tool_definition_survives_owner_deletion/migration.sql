-- DropForeignKey
ALTER TABLE "ToolDefinition" DROP CONSTRAINT "ToolDefinition_createdBy_fkey";

-- AlterTable
ALTER TABLE "ToolDefinition" ALTER COLUMN "createdBy" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ToolDefinition" ADD CONSTRAINT "ToolDefinition_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
