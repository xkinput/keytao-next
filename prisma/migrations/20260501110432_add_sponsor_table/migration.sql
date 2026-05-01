-- CreateTable
CREATE TABLE "sponsors" (
    "id" SERIAL NOT NULL,
    "payerName" TEXT NOT NULL,
    "remark" TEXT,
    "amount" INTEGER NOT NULL,
    "message" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'other',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id")
);
