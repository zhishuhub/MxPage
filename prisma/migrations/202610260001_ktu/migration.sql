CREATE TABLE "KtuCity" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "tier" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "KtuCity_name_key" ON "KtuCity"("name");
CREATE TABLE "KtuVenue" (
  "id" TEXT NOT NULL PRIMARY KEY, "cityId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "district" TEXT NOT NULL DEFAULT '', "sortOrder" INTEGER NOT NULL DEFAULT 0, "lastUsedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("cityId") REFERENCES "KtuCity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "KtuVenue_cityId_name_key" ON "KtuVenue"("cityId", "name");
CREATE INDEX "KtuVenue_cityId_sortOrder_idx" ON "KtuVenue"("cityId", "sortOrder");
CREATE TABLE "KtuSchedule" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "scope" TEXT NOT NULL, "cityIds" JSONB NOT NULL, "tiers" JSONB NOT NULL, "templateKeys" JSONB NOT NULL,
  "frequency" TEXT NOT NULL, "timeOfDay" TEXT NOT NULL DEFAULT '09:00', "weekdays" JSONB NOT NULL,
  "intervalHours" INTEGER NOT NULL DEFAULT 24, "setsPerRun" INTEGER NOT NULL DEFAULT 5,
  "dailyLimit" INTEGER NOT NULL DEFAULT 0, "aspect" TEXT NOT NULL DEFAULT '3:4',
  "outputDir" TEXT NOT NULL DEFAULT '', "cursor" JSONB NOT NULL,
  "nextRunAt" DATETIME, "lastRunAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "KtuScheduleRun" (
  "id" TEXT NOT NULL PRIMARY KEY, "scheduleId" TEXT, "kind" TEXT NOT NULL DEFAULT 'schedule',
  "outputDir" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL DEFAULT 'running',
  "planned" JSONB NOT NULL, "nextIndex" INTEGER NOT NULL DEFAULT 0,
  "succeeded" INTEGER NOT NULL DEFAULT 0, "failed" INTEGER NOT NULL DEFAULT 0,
  "message" TEXT, "notified" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" DATETIME,
  FOREIGN KEY ("scheduleId") REFERENCES "KtuSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "KtuScheduleRun_scheduleId_startedAt_idx" ON "KtuScheduleRun"("scheduleId", "startedAt");
CREATE TABLE "KtuJob" (
  "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "templateKey" TEXT NOT NULL,
  "cityId" TEXT, "cityName" TEXT NOT NULL, "venueIds" JSONB NOT NULL,
  "aspect" TEXT NOT NULL DEFAULT '3:4', "scheduleRunId" TEXT, "exportedPath" TEXT, "excluded" JSONB, "settledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("scheduleRunId") REFERENCES "KtuScheduleRun"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "KtuJob_projectId_key" ON "KtuJob"("projectId");
CREATE INDEX "KtuJob_createdAt_idx" ON "KtuJob"("createdAt");
CREATE INDEX "KtuJob_scheduleRunId_idx" ON "KtuJob"("scheduleRunId");
