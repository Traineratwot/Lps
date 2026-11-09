import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // .env подхватывается bun, но конфиг может читаться раньше — страхуемся fallback'ом
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
