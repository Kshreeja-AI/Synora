-- CreateEnum
CREATE TYPE "MFAType" AS ENUM ('TOTP');

-- CreateEnum
CREATE TYPE "MFAStatus" AS ENUM ('SETUP_PENDING', 'ACTIVE', 'DISABLED', 'RECOVERY_MODE');

-- CreateTable "MFAMethod"
CREATE TABLE "MFAMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "MFAType" NOT NULL DEFAULT 'TOTP',
    "status" "MFAStatus" NOT NULL DEFAULT 'SETUP_PENDING',
    "secret" TEXT,
    "backupCodesHash" TEXT[],
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabledAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "MFAMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable "MFAAttempt"
CREATE TABLE "MFAAttempt" (
    "id" TEXT NOT NULL,
    "mfaMethodId" TEXT NOT NULL,
    "sessionId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "code" TEXT,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MFAAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable "MFAChallengeToken"
CREATE TABLE "MFAChallengeToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sessionId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "MFAChallengeToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable "MFARecoveryCode"
CREATE TABLE "MFARecoveryCode" (
    "id" TEXT NOT NULL,
    "mfaMethodId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MFARecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable "MFASetupToken"
CREATE TABLE "MFASetupToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MFASetupToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MFAMethod_userId_type_key" ON "MFAMethod"("userId", "type");

-- CreateIndex
CREATE INDEX "MFAMethod_userId_idx" ON "MFAMethod"("userId");

-- CreateIndex
CREATE INDEX "MFAMethod_status_idx" ON "MFAMethod"("status");

-- CreateIndex
CREATE INDEX "MFAAttempt_mfaMethodId_idx" ON "MFAAttempt"("mfaMethodId");

-- CreateIndex
CREATE INDEX "MFAAttempt_createdAt_idx" ON "MFAAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "MFAAttempt_success_idx" ON "MFAAttempt"("success");

-- CreateIndex
CREATE INDEX "MFAAttempt_mfaMethodId_createdAt_idx" ON "MFAAttempt"("mfaMethodId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MFAChallengeToken_tokenHash_key" ON "MFAChallengeToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MFAChallengeToken_tokenHash_idx" ON "MFAChallengeToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MFAChallengeToken_userId_idx" ON "MFAChallengeToken"("userId");

-- CreateIndex
CREATE INDEX "MFAChallengeToken_expiresAt_idx" ON "MFAChallengeToken"("expiresAt");

-- CreateIndex
CREATE INDEX "MFAChallengeToken_userId_createdAt_idx" ON "MFAChallengeToken"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MFARecoveryCode_codeHash_key" ON "MFARecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "MFARecoveryCode_mfaMethodId_idx" ON "MFARecoveryCode"("mfaMethodId");

-- CreateIndex
CREATE INDEX "MFARecoveryCode_usedAt_idx" ON "MFARecoveryCode"("usedAt");

-- CreateIndex
CREATE INDEX "MFARecoveryCode_mfaMethodId_createdAt_idx" ON "MFARecoveryCode"("mfaMethodId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MFASetupToken_tokenHash_key" ON "MFASetupToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MFASetupToken_tokenHash_idx" ON "MFASetupToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MFASetupToken_userId_idx" ON "MFASetupToken"("userId");

-- CreateIndex
CREATE INDEX "MFASetupToken_expiresAt_idx" ON "MFASetupToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "MFAMethod" ADD CONSTRAINT "MFAMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MFAAttempt" ADD CONSTRAINT "MFAAttempt_mfaMethodId_fkey" FOREIGN KEY ("mfaMethodId") REFERENCES "MFAMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MFAChallengeToken" ADD CONSTRAINT "MFAChallengeToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MFARecoveryCode" ADD CONSTRAINT "MFARecoveryCode_mfaMethodId_fkey" FOREIGN KEY ("mfaMethodId") REFERENCES "MFAMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MFASetupToken" ADD CONSTRAINT "MFASetupToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
