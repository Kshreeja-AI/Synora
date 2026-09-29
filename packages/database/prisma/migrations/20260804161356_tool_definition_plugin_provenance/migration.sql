-- AlterTable
ALTER TABLE "ToolDefinition" ADD COLUMN     "pluginId" TEXT;

-- CreateIndex
CREATE INDEX "ToolDefinition_workspaceId_pluginId_idx" ON "ToolDefinition"("workspaceId", "pluginId");
