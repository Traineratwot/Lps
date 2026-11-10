-- Systemd services index, linked to packages and commands.
CREATE TABLE "SystemdService" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "unitPath" TEXT NOT NULL DEFAULT '',
    "activeState" TEXT NOT NULL DEFAULT '',
    "subState" TEXT NOT NULL DEFAULT '',
    "enabledState" TEXT NOT NULL DEFAULT '',
    "execStart" TEXT NOT NULL DEFAULT '',
    "execStartPath" TEXT NOT NULL DEFAULT '',
    "user" TEXT NOT NULL DEFAULT '',
    "wantedBy" TEXT NOT NULL DEFAULT '',
    "mainPid" INTEGER,
    "packageId" INTEGER,
    "commandId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SystemdService_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SystemdService_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "Command" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SystemdService_name_key" ON "SystemdService"("name");
CREATE INDEX "SystemdService_activeState_idx" ON "SystemdService"("activeState");
CREATE INDEX "SystemdService_enabledState_idx" ON "SystemdService"("enabledState");
