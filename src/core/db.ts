import { Database } from "bun:sqlite";
import { PrismaClient } from "../generated/prisma/client.ts";
import { BunSqliteAdapterFactory } from "./db/bun-sqlite-adapter.ts";
import { MIGRATIONS } from "./db/schema-sql.ts";

export type Db = PrismaClient;

/** Creates a Prisma client bound to a SQLite file via the bundled bun:sqlite adapter. */
export function createDb(dbPath: string): PrismaClient {
  const adapter = new BunSqliteAdapterFactory({
    url: dbPath,
    create: true,
  });
  return new PrismaClient({ adapter });
}

/**
 * Applies embedded migrations in order (idempotent).
 * Applied names are tracked in the Meta table so future migrations
 * run incrementally. Multi-statement DDL goes through bun:sqlite
 * directly — Prisma's $executeRawUnsafe accepts a single statement only.
 */
export async function ensureSchema(dbPath: string): Promise<void> {
  const raw = new Database(dbPath, { create: true });
  try {
    raw.exec(`CREATE TABLE IF NOT EXISTS "Meta" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)`);
    const row = raw
      .query(`SELECT "value" FROM "Meta" WHERE "key" = 'applied_migrations'`)
      .get() as { value: string } | null;
    const applied = new Set<string>(row ? (JSON.parse(row.value) as string[]) : []);

    const pending = MIGRATIONS.filter((m) => !applied.has(m.name));
    if (pending.length === 0) return;

    for (const migration of pending) {
      raw.exec("BEGIN");
      try {
        raw.exec(migration.sql);
        applied.add(migration.name);
        raw
          .query(
            `INSERT INTO "Meta" ("key", "value") VALUES ('applied_migrations', ?)
             ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`,
          )
          .run(JSON.stringify([...applied]));
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    }
  } finally {
    raw.close();
  }
}
