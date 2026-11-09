-- DropIndex
DROP INDEX "Command_name_path_key";

-- CreateIndex
CREATE UNIQUE INDEX "Command_name_path_kind_key" ON "Command"("name", "path", "kind");
