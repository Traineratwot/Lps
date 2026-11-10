import { accessSync, constants, existsSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { PrismaClient } from "../generated/prisma/client.ts";
import { BunSqliteAdapterFactory } from "./db/bun-sqlite-adapter.ts";
import { MIGRATIONS } from "./db/schema-sql.ts";
import type { LpsConfig } from "./config.ts";

export type Db = PrismaClient;

/** Thrown when the database cannot be opened at all (missing + not writable). */
export class DbOpenError extends Error {
  constructor(
    readonly dbPath: string,
    message: string,
  ) {
    super(message);
    this.name = "DbOpenError";
  }
}

export type CreateDbOptions = {
  /** Open without write access (for read-only commands run as non-root). */
  readonly?: boolean;
};

/** Creates a Prisma client bound to a SQLite file via the bundled bun:sqlite adapter. */
export function createDb(dbPath: string, options: CreateDbOptions = {}): PrismaClient {
  const adapter = new BunSqliteAdapterFactory({
    url: dbPath,
    create: !options.readonly,
    readonly: options.readonly ?? false,
  });
  return new PrismaClient({ adapter });
}

/**
 * Whether we can use the database read-write. The file itself may be
 * writable while its directory is not — SQLite still needs to create WAL
 * and SHM sidecar files next to the database (plan risk P: readonly WAL).
 */
function isWritable(dbPath: string): boolean {
  try {
    accessSync(dbPath, constants.W_OK);
    accessSync(dirname(dbPath), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens the DB for read queries. Works without root on a root-owned DB:
 * falls back to read-only mode, so `sudo lps scan` + `lps list` as a user
 * is the normal workflow.
 *
 * Throws {@link DbOpenError} when the DB is missing and cannot be created —
 * callers print the actionable hint.
 */
export async function openDb(config: LpsConfig): Promise<Db> {
  const exists = existsSync(config.dbPath);
  if (exists && !isWritable(config.dbPath)) {
    return createDb(config.dbPath, { readonly: true });
  }
  if (!exists && !isWritable(config.dataDir)) {
    throw new DbOpenError(
      config.dbPath,
      `Database not found: ${config.dbPath} (and ${config.dataDir} is not writable)`,
    );
  }
  await ensureSchema(config.dbPath);
  return createDb(config.dbPath);
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
    raw.exec("PRAGMA foreign_keys = ON");
    raw.exec("PRAGMA busy_timeout = 5000");
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
