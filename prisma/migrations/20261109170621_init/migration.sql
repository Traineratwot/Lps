-- CreateTable
CREATE TABLE "ScanRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "stages" TEXT,
    "stats" TEXT
);

-- CreateTable
CREATE TABLE "Command" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '',
    "realPath" TEXT NOT NULL DEFAULT '',
    "aliasOf" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "isSymlink" BOOLEAN NOT NULL DEFAULT false,
    "size" INTEGER,
    "mode" INTEGER,
    "ownerId" INTEGER,
    "packageId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Command_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommandDoc" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "commandId" INTEGER NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "manPath" TEXT NOT NULL DEFAULT '',
    "manSection" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "helpFlag" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "CommandDoc_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "Command" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Package" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "architecture" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "maintainer" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "section" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL DEFAULT '',
    "installPath" TEXT NOT NULL DEFAULT '',
    "meta" TEXT NOT NULL DEFAULT '{}'
);

-- CreateTable
CREATE TABLE "DesktopEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "filePath" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "exec" TEXT NOT NULL DEFAULT '',
    "tryExec" TEXT NOT NULL DEFAULT '',
    "iconName" TEXT NOT NULL DEFAULT '',
    "iconPath" TEXT NOT NULL DEFAULT '',
    "categories" TEXT NOT NULL DEFAULT '',
    "mimeTypes" TEXT NOT NULL DEFAULT '',
    "terminal" BOOLEAN NOT NULL DEFAULT false,
    "noDisplay" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "wmClass" TEXT NOT NULL DEFAULT '',
    "meta" TEXT NOT NULL DEFAULT '{}',
    "packageId" INTEGER,
    "commandId" INTEGER,
    CONSTRAINT "DesktopEntry_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DesktopEntry_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "Command" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Process" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pid" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "ppid" INTEGER,
    "uid" INTEGER,
    "user" TEXT NOT NULL DEFAULT '',
    "cmdline" TEXT NOT NULL DEFAULT '',
    "exePath" TEXT NOT NULL DEFAULT '',
    "isKernel" BOOLEAN NOT NULL DEFAULT false,
    "commandId" INTEGER,
    "packageId" INTEGER,
    CONSTRAINT "Process_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "Command" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Process_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scanRunId" INTEGER NOT NULL,
    "processId" INTEGER NOT NULL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uptimeSec" INTEGER NOT NULL DEFAULT 0,
    "cpuPercent" REAL,
    "rssKb" INTEGER,
    "state" TEXT NOT NULL DEFAULT '',
    "threads" INTEGER,
    CONSTRAINT "ProcessSnapshot_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProcessSnapshot_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Meta" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Command_name_idx" ON "Command"("name");

-- CreateIndex
CREATE INDEX "Command_realPath_idx" ON "Command"("realPath");

-- CreateIndex
CREATE UNIQUE INDEX "Command_name_path_key" ON "Command"("name", "path");

-- CreateIndex
CREATE UNIQUE INDEX "CommandDoc_commandId_key" ON "CommandDoc"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "Package_type_name_key" ON "Package"("type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DesktopEntry_filePath_key" ON "DesktopEntry"("filePath");

-- CreateIndex
CREATE INDEX "DesktopEntry_name_idx" ON "DesktopEntry"("name");

-- CreateIndex
CREATE INDEX "Process_commandId_idx" ON "Process"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "Process_pid_startedAt_key" ON "Process"("pid", "startedAt");

-- CreateIndex
CREATE INDEX "ProcessSnapshot_processId_observedAt_idx" ON "ProcessSnapshot"("processId", "observedAt");

-- CreateIndex
CREATE INDEX "ProcessSnapshot_scanRunId_idx" ON "ProcessSnapshot"("scanRunId");
