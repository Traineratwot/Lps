import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";
import { normalizeSqliteUrl } from "./src/core/db/sqlite-url.ts";

// import.meta.dir is Bun-only; prisma CLI loads this config under Node too.
const projectDir = dirname(fileURLToPath(import.meta.url));
const rawUrl = process.env.DATABASE_URL ?? resolve(projectDir, "dev.db");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: normalizeSqliteUrl(rawUrl, process.cwd()),
  },
});
