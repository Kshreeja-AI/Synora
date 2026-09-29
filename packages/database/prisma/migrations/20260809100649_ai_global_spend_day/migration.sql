-- CreateTable
CREATE TABLE "AiGlobalSpendDay" (
    "dayUtc" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGlobalSpendDay_pkey" PRIMARY KEY ("dayUtc")
);
