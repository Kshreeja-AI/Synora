-- Add FK constraint for StreamingJob.messageId (M2 correctness)
-- One-to-one relationship: each successful job creates exactly one assistant message
ALTER TABLE "StreamingJob" ADD CONSTRAINT "StreamingJob_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Unique constraint ensures one-to-one relationship (multiple nulls allowed for failed jobs)
ALTER TABLE "StreamingJob" ADD CONSTRAINT "StreamingJob_messageId_key" UNIQUE ("messageId");

-- Composite index for job status queries per conversation
CREATE INDEX "StreamingJob_conversationId_status_idx" ON "StreamingJob"("conversationId", "status");
