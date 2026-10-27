ALTER TABLE "KtuJob" ADD COLUMN "templateName" TEXT NOT NULL DEFAULT '';
CREATE TABLE "KtuTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY, "key" TEXT NOT NULL, "name" TEXT NOT NULL,
  "builtin" BOOLEAN NOT NULL DEFAULT false,
  "minVenues" INTEGER NOT NULL, "maxVenues" INTEGER NOT NULL,
  "pick" TEXT NOT NULL, "pages" TEXT NOT NULL, "pageCount" INTEGER NOT NULL DEFAULT 4,
  "content" TEXT NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "KtuTemplate_key_key" ON "KtuTemplate"("key");
CREATE TABLE "KtuSetting" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  "reviewEnabled" BOOLEAN NOT NULL DEFAULT true,
  "reviewRequirements" TEXT NOT NULL DEFAULT '',
  "updatedAt" DATETIME NOT NULL
);
