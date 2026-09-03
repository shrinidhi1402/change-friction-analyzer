-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "summary" JSONB NOT NULL,
    "commitCount" INTEGER NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileMetric" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "dependencyImpact" DOUBLE PRECISION NOT NULL,
    "changeFrequency" DOUBLE PRECISION NOT NULL,
    "coChangeCoupling" DOUBLE PRECISION NOT NULL,
    "contributorComplexity" DOUBLE PRECISION NOT NULL,
    "historicalRisk" DOUBLE PRECISION NOT NULL,
    "frictionScore" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT NOT NULL,
    "dependencyCount" INTEGER NOT NULL,
    "dependentCount" INTEGER NOT NULL,
    "changeCount" INTEGER NOT NULL,
    "contributorCount" INTEGER NOT NULL,
    "coChangedWith" TEXT[],
    "historicalEvidence" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Repository_userId_idx" ON "Repository"("userId");

-- CreateIndex
CREATE INDEX "Analysis_repositoryId_idx" ON "Analysis"("repositoryId");

-- CreateIndex
CREATE INDEX "File_repositoryId_idx" ON "File"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "File_repositoryId_path_key" ON "File"("repositoryId", "path");

-- CreateIndex
CREATE INDEX "FileMetric_analysisId_idx" ON "FileMetric"("analysisId");

-- CreateIndex
CREATE INDEX "FileMetric_fileId_idx" ON "FileMetric"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "FileMetric_analysisId_fileId_key" ON "FileMetric"("analysisId", "fileId");

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileMetric" ADD CONSTRAINT "FileMetric_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileMetric" ADD CONSTRAINT "FileMetric_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
