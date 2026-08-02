-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "pastDueSince" TIMESTAMP(3),
ADD COLUMN     "paymentFailureCount" INTEGER NOT NULL DEFAULT 0;
