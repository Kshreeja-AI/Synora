-- Drop the unique constraint on token field (security: don't store raw tokens)
ALTER TABLE "CsrfToken" DROP CONSTRAINT "CsrfToken_token_key";

-- Drop the token column (security fix: raw tokens should not be in database)
ALTER TABLE "CsrfToken" DROP COLUMN "token";

-- Add IP address for rate limiting
ALTER TABLE "CsrfToken" ADD COLUMN "ipAddress" TEXT;

-- Add user agent for audit trail
ALTER TABLE "CsrfToken" ADD COLUMN "userAgent" TEXT;

-- Create index for rate limiting queries: (ipAddress, createdAt)
CREATE INDEX "CsrfToken_ipAddress_createdAt_idx" ON "CsrfToken"("ipAddress", "createdAt");
