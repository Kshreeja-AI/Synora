-- Fix schema drift: schema.prisma declares ToolDefinition.type,
-- ToolDefinition.permission, ToolExecution.status, and
-- ToolInvocation.status as the enums ToolType / ToolPermission /
-- ExecutionStatus, but the 20260730120000_add_universal_tool_engine
-- migration created all four columns as plain TEXT and never created
-- the enum types themselves. Prisma Client (generated from
-- schema.prisma, which believes these are real Postgres enums) fails
-- every insert/query against them with:
--   type "public.ToolType" does not exist
--
-- This migration creates the three missing enum types and converts
-- the four affected columns in place. No data currently depends on
-- this (these tables are new, unreleased, and unused in production),
-- but the USING casts make this safe to run even if rows exist, since
-- every existing TEXT value was already constrained by application
-- code to the same set of strings the enum now declares.

-- CreateEnum
CREATE TYPE "ToolType" AS ENUM ('HTTP', 'GraphQL', 'Database', 'Search', 'File', 'Browser', 'Python', 'Webhook', 'MCP', 'Custom');

-- CreateEnum
CREATE TYPE "ToolPermission" AS ENUM ('PRIVATE', 'WORKSPACE', 'SHARED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'APPROVED', 'RUNNING', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'REJECTED');

-- AlterTable: ToolDefinition.type (TEXT -> ToolType, no default to preserve)
ALTER TABLE "ToolDefinition"
  ALTER COLUMN "type" TYPE "ToolType" USING "type"::"ToolType";

-- AlterTable: ToolDefinition.permission (TEXT DEFAULT 'PRIVATE' -> ToolPermission DEFAULT 'PRIVATE')
ALTER TABLE "ToolDefinition"
  ALTER COLUMN "permission" DROP DEFAULT,
  ALTER COLUMN "permission" TYPE "ToolPermission" USING "permission"::"ToolPermission",
  ALTER COLUMN "permission" SET DEFAULT 'PRIVATE';

-- AlterTable: ToolExecution.status (TEXT DEFAULT 'PENDING' -> ExecutionStatus DEFAULT 'PENDING')
ALTER TABLE "ToolExecution"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ExecutionStatus" USING "status"::"ExecutionStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable: ToolInvocation.status (TEXT DEFAULT 'PENDING' -> ExecutionStatus DEFAULT 'PENDING')
ALTER TABLE "ToolInvocation"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ExecutionStatus" USING "status"::"ExecutionStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING';
