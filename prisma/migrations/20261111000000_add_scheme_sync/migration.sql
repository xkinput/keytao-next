-- CreateEnum
CREATE TYPE "SchemePackageStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "scheme_profiles" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updateAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheme_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scheme_packages" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "schemeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "SchemePackageStatus" NOT NULL DEFAULT 'PENDING',
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheme_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scheme_profiles_userId_key" ON "scheme_profiles"("userId");
CREATE UNIQUE INDEX "scheme_packages_storageKey_key" ON "scheme_packages"("storageKey");
CREATE INDEX "scheme_packages_userId_idx" ON "scheme_packages"("userId");

-- AddForeignKey
ALTER TABLE "scheme_profiles" ADD CONSTRAINT "scheme_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheme_packages" ADD CONSTRAINT "scheme_packages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
