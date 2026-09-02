-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hubId" INTEGER NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "scopes" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hubspotId" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "lifecycleStage" TEXT,
    "hubspotCreatedAt" DATETIME,
    "hubspotUpdatedAt" DATETIME,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "raw" TEXT NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hubspotId" TEXT NOT NULL,
    "dealName" TEXT,
    "amount" REAL,
    "dealStage" TEXT,
    "pipeline" TEXT,
    "closeDate" DATETIME,
    "hubspotCreatedAt" DATETIME,
    "hubspotUpdatedAt" DATETIME,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "raw" TEXT NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "subscriptionType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "occurredAt" DATETIME,
    "changeSource" TEXT,
    "payload" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processingError" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordsSynced" INTEGER NOT NULL DEFAULT 0,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_hubId_key" ON "Account"("hubId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_hubspotId_key" ON "Contact"("hubspotId");

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "Contact_lifecycleStage_idx" ON "Contact"("lifecycleStage");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_hubspotId_key" ON "Deal"("hubspotId");

-- CreateIndex
CREATE INDEX "Deal_dealStage_idx" ON "Deal"("dealStage");

-- CreateIndex
CREATE INDEX "Deal_pipeline_idx" ON "Deal"("pipeline");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");
