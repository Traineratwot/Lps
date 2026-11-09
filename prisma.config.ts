import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prisma 7 / Studio требуют форму file://<path>; file:<path> Studio
    // отвергает ("not supported for the file:... protocol", studio#1578).
    url: process.env.DATABASE_URL ?? "file://./dev.db",
  },
});
