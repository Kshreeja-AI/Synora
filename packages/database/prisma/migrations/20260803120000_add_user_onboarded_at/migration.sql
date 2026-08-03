-- Track when a user first completed (or explicitly skipped) the onboarding flow.
-- Nullable so existing users are treated as "never onboarded" and get the
-- welcome experience on their next visit — or the frontend can decide to
-- backfill them silently. Either policy is a client-side choice; the schema
-- only records the fact.
ALTER TABLE "User" ADD COLUMN "onboardedAt" TIMESTAMP(3);
