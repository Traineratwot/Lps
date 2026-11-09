-- Command identity: (name,path,kind) → unique content hash; paths/names/aliases
-- become JSON arrays. Old rows have no hash — wiped; the next scan rebuilds.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
DELETE FROM "CommandDoc";
DELETE FROM "Command";
CREATE TABLE "new_Command" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "names" TEXT NOT NULL DEFAULT '[]',
    "paths" TEXT NOT NULL DEFAULT '[]',
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "realPath" TEXT NOT NULL DEFAULT '',
    "isSymlink" BOOLEAN NOT NULL DEFAULT false,
    "size" INTEGER,
    "mode" INTEGER,
    "ownerId" INTEGER,
    "dev" INTEGER,
    "inode" INTEGER,
    "mtimeMs" INTEGER,
    "packageId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Command_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Command" ("createdAt", "id", "isSymlink", "kind", "mode", "name", "ownerId", "packageId", "realPath", "size", "source", "updatedAt") SELECT "createdAt", "id", "isSymlink", "kind", "mode", "name", "ownerId", "packageId", "realPath", "size", "source", "updatedAt" FROM "Command";
DROP TABLE "Command";
ALTER TABLE "new_Command" RENAME TO "Command";
CREATE UNIQUE INDEX "Command_hash_key" ON "Command"("hash");
CREATE INDEX "Command_name_idx" ON "Command"("name");
CREATE INDEX "Command_realPath_idx" ON "Command"("realPath");
UPDATE "DesktopEntry" SET "commandId" = NULL;
UPDATE "Process" SET "commandId" = NULL;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
