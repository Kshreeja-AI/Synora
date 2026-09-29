-- Per-message token accounting and provider attribution.
-- Written by the generation worker so counts survive page reloads and can be
-- aggregated for usage/analytics without replaying SSE streams.
ALTER TABLE "Message" ADD COLUMN "inputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Message" ADD COLUMN "outputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Message" ADD COLUMN "costCents" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Message" ADD COLUMN "provider" TEXT;
ALTER TABLE "Message" ADD COLUMN "model" TEXT;
