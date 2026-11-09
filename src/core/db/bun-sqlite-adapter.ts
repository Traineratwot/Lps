/**
 * Prisma driver adapter over Bun's built-in `bun:sqlite`.
 *
 * Written for single-file `bun build --compile` output: no native .node modules.
 * Contract: @prisma/driver-adapter-utils (SqlDriverAdapterFactory / SqlDriverAdapter).
 * Value/type mapping follows @prisma/adapter-better-sqlite3.
 */
import { Database, type SQLQueryBindings } from "bun:sqlite";
import {
  ColumnTypeEnum,
  DriverAdapterError,
  type ColumnType,
  type ConnectionInfo,
  type Error as AdapterErrorPayload,
  type IsolationLevel,
  type MappedError,
  type SqlDriverAdapter,
  type SqlDriverAdapterFactory,
  type SqlMigrationAwareDriverAdapterFactory,
  type SqlQuery,
  type SqlResultSet,
  type Transaction,
  type TransactionOptions,
} from "@prisma/driver-adapter-utils";

const ADAPTER_NAME = "lps/bun-sqlite";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function isDriverError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function mapDriverError(error: { code: string; message: string }): MappedError {
  switch (error.code) {
    case "SQLITE_CONSTRAINT_UNIQUE":
    case "SQLITE_CONSTRAINT_PRIMARYKEY": {
      const columns = error.message.split("constraint failed: ").at(1)?.split(", ");
      const fields = columns?.map((field) => field.split(".").pop()) as string[] | undefined;
      const table = columns?.at(0)?.split(".").slice(0, -1).join(".") || undefined;
      return {
        kind: "UniqueConstraintViolation",
        constraint: fields !== undefined ? { fields } : undefined,
        table,
      };
    }
    case "SQLITE_CONSTRAINT_NOTNULL": {
      const fields = error.message
        .split("constraint failed: ")
        .at(1)
        ?.split(", ")
        .map((field) => field.split(".").pop()) as string[] | undefined;
      return {
        kind: "NullConstraintViolation",
        constraint: fields !== undefined ? { fields } : undefined,
      };
    }
    case "SQLITE_CONSTRAINT_FOREIGNKEY":
    case "SQLITE_CONSTRAINT_TRIGGER":
      return { kind: "ForeignKeyConstraintViolation", constraint: { foreignKey: {} } };
    default: {
      if (error.code.startsWith("SQLITE_BUSY") || error.code.startsWith("SQLITE_LOCKED")) {
        return { kind: "SocketTimeout" };
      }
      if (error.message.startsWith("no such table")) {
        return { kind: "TableDoesNotExist", table: error.message.split(": ").at(1) ?? "" };
      }
      if (error.message.startsWith("no such column") || error.message.includes("has no column named ")) {
        const column = error.message.startsWith("no such column")
          ? (error.message.split(": ").at(1) ?? "")
          : (error.message.split("has no column named ").at(1) ?? "");
        return { kind: "ColumnNotFound", column };
      }
      return { kind: "GenericJs", id: 1 };
    }
  }
}

function convertDriverError(error: unknown): never {
  if (isDriverError(error)) {
    const payload: AdapterErrorPayload = {
      ...(mapDriverError(error) as object),
      originalCode: error.code,
      originalMessage: error.message,
    } as AdapterErrorPayload;
    throw new DriverAdapterError(payload);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Value conversion
// ---------------------------------------------------------------------------

function mapDeclType(declType: string | null | undefined): ColumnType | null {
  if (!declType) return null;
  switch (declType.toUpperCase()) {
    case "DECIMAL":
      return ColumnTypeEnum.Numeric;
    case "FLOAT":
      return ColumnTypeEnum.Float;
    case "DOUBLE":
    case "DOUBLE PRECISION":
    case "NUMERIC":
    case "REAL":
      return ColumnTypeEnum.Double;
    case "TINYINT":
    case "SMALLINT":
    case "MEDIUMINT":
    case "INT":
    case "INTEGER":
    case "SERIAL":
    case "INT2":
      return ColumnTypeEnum.Int32;
    case "BIGINT":
    case "UNSIGNED BIG INT":
    case "INT8":
      return ColumnTypeEnum.Int64;
    case "DATETIME":
    case "TIMESTAMP":
      return ColumnTypeEnum.DateTime;
    case "TIME":
      return ColumnTypeEnum.Time;
    case "DATE":
      return ColumnTypeEnum.Date;
    case "TEXT":
    case "CLOB":
    case "CHARACTER":
    case "VARCHAR":
    case "VARYING CHARACTER":
    case "NCHAR":
    case "NATIVE CHARACTER":
    case "NVARCHAR":
      return ColumnTypeEnum.Text;
    case "BLOB":
      return ColumnTypeEnum.Bytes;
    case "BOOLEAN":
      return ColumnTypeEnum.Boolean;
    case "JSONB":
      return ColumnTypeEnum.Json;
    default:
      return null;
  }
}

type Cell = unknown;

function inferColumnType(value: Cell): ColumnType {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return ColumnTypeEnum.Bytes;
  switch (typeof value) {
    case "string":
      return ColumnTypeEnum.Text;
    case "bigint":
      return ColumnTypeEnum.Int64;
    case "boolean":
      return ColumnTypeEnum.Boolean;
    case "number":
      return ColumnTypeEnum.UnknownNumber;
    default:
      return ColumnTypeEnum.Text;
  }
}

function getColumnTypes(declaredTypes: Array<string | null | undefined>, rows: Cell[][]): ColumnType[] {
  const columnTypes: Array<ColumnType | null> = declaredTypes.map((t) => mapDeclType(t));
  const emptyIndices = new Set<number>();
  columnTypes.forEach((t, i) => {
    if (t === null) emptyIndices.add(i);
  });
  if (emptyIndices.size === 0) return columnTypes as ColumnType[];

  for (const columnIndex of emptyIndices) {
    let inferred: ColumnType = ColumnTypeEnum.Int32;
    for (const row of rows) {
      const candidate = row[columnIndex];
      if (candidate !== null && candidate !== undefined) {
        inferred = inferColumnType(candidate);
        break;
      }
    }
    columnTypes[columnIndex] = inferred;
  }
  return columnTypes as ColumnType[];
}

function mapRow(row: Cell[], columnTypes: ColumnType[]): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < row.length; i++) {
    const value = row[i];
    if (
      typeof value === "number" &&
      (columnTypes[i] === ColumnTypeEnum.Int32 || columnTypes[i] === ColumnTypeEnum.Int64) &&
      !Number.isInteger(value)
    ) {
      result[i] = Math.trunc(value);
      continue;
    }
    if (["number", "bigint"].includes(typeof value) && columnTypes[i] === ColumnTypeEnum.DateTime) {
      result[i] = new Date(Number(value)).toISOString();
      continue;
    }
    if (typeof value === "bigint") {
      const asNumber = Number(value);
      result[i] = Number.isSafeInteger(asNumber) ? asNumber : String(value);
      continue;
    }
    result[i] = value;
  }
  return result;
}

type ArgTypeLike = SqlQuery["argTypes"][number];

function mapArg(arg: unknown, argType: ArgTypeLike | undefined): SQLQueryBindings {
  if (arg === null || arg === undefined) return null;

  const scalar = argType?.scalarType;

  if (typeof arg === "string") {
    if (scalar === "int") return Number.parseInt(arg, 10);
    if (scalar === "float" || scalar === "decimal") return Number.parseFloat(arg);
    if (scalar === "bigint") return BigInt(arg);
    if (scalar === "bytes") return Buffer.from(arg, "base64");
    if (scalar === "datetime") return new Date(arg).toISOString().replace("Z", "+00:00");
    return arg;
  }
  if (typeof arg === "boolean") return arg ? 1 : 0;
  if (arg instanceof Date) return arg.toISOString().replace("Z", "+00:00");
  if (typeof arg === "number" || typeof arg === "bigint") return arg;
  if (arg instanceof Uint8Array) return arg;
  return String(arg);
}

function mapArgs(query: SqlQuery): SQLQueryBindings[] {
  return query.args.map((arg, i) => mapArg(arg, query.argTypes[i]));
}

// ---------------------------------------------------------------------------
// Queryable base
// ---------------------------------------------------------------------------

class BunSqliteQueryable {
  readonly provider = "sqlite" as const;
  readonly adapterName = ADAPTER_NAME;

  constructor(protected readonly client: Database) {}

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    try {
      const args = mapArgs(query);
      const stmt = this.client.prepare(query.sql);
      if (!stmt.reader) {
        stmt.run(...args);
        return { columnNames: [], columnTypes: [], rows: [] };
      }
      const rows = stmt.values(...args) as Cell[][];
      const columnNames = [...stmt.columnNames];
      const columnTypes = getColumnTypes(stmt.declaredTypes, rows);
      return {
        columnNames,
        columnTypes,
        rows: rows.map((row) => mapRow(row, columnTypes)),
      };
    } catch (error) {
      convertDriverError(error);
    }
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    try {
      const args = mapArgs(query);
      const stmt = this.client.prepare(query.sql);
      const result = stmt.run(...args);
      return result.changes;
    } catch (error) {
      convertDriverError(error);
    }
  }
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

class BunSqliteTransaction extends BunSqliteQueryable implements Transaction {
  readonly options: TransactionOptions = { usePhantomQuery: false };

  constructor(
    client: Database,
    private readonly unlockParent: () => void,
  ) {
    super(client);
  }

  async commit(): Promise<void> {
    try {
      this.client.run("COMMIT");
    } catch (error) {
      convertDriverError(error);
    } finally {
      this.unlockParent();
    }
  }

  async rollback(): Promise<void> {
    try {
      this.client.run("ROLLBACK");
    } catch (error) {
      convertDriverError(error);
    } finally {
      this.unlockParent();
    }
  }

  async createSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `SAVEPOINT ${name}`, args: [], argTypes: [] });
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `ROLLBACK TO ${name}`, args: [], argTypes: [] });
  }

  async releaseSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `RELEASE SAVEPOINT ${name}`, args: [], argTypes: [] });
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/** Serializes transactions: SQLite allows a single writer. */
class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.release.bind(this);
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    return this.release.bind(this);
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.locked = false;
  }
}

export class BunSqliteAdapter extends BunSqliteQueryable implements SqlDriverAdapter {
  private readonly mutex = new Mutex();

  async executeScript(script: string): Promise<void> {
    try {
      this.client.exec(script);
    } catch (error) {
      convertDriverError(error);
    }
  }

  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    if (isolationLevel && isolationLevel !== "SERIALIZABLE") {
      throw new DriverAdapterError({ kind: "InvalidIsolationLevel", level: isolationLevel });
    }
    const release = await this.mutex.acquire();
    try {
      this.client.run("BEGIN");
    } catch (error) {
      release();
      convertDriverError(error);
    }
    return new BunSqliteTransaction(this.client, release);
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      supportsRelationJoins: false,
      maxBindValues: 32766,
    };
  }

  async dispose(): Promise<void> {
    this.client.close();
  }
}

export type BunSqliteAdapterConfig = {
  /** Filesystem path or ":memory:". */
  url: string;
  readonly?: boolean;
  create?: boolean;
};

function openDatabase(config: BunSqliteAdapterConfig): Database {
  const path = config.url.replace(/^file:/, "");
  const db = new Database(path, {
    create: config.create ?? true,
    readonly: config.readonly ?? false,
  });
  // SQLite does not enforce FKs unless asked — ON DELETE CASCADE and
  // relation integrity depend on this (caught by db.test.ts).
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (!config.readonly) {
    try {
      db.exec("PRAGMA journal_mode = WAL");
    } catch {
      // in-memory databases cannot use WAL
    }
  }
  return db;
}

export class BunSqliteAdapterFactory implements SqlMigrationAwareDriverAdapterFactory {
  readonly provider = "sqlite" as const;
  readonly adapterName = ADAPTER_NAME;

  constructor(private readonly config: BunSqliteAdapterConfig) {}

  async connect(): Promise<SqlDriverAdapter> {
    return new BunSqliteAdapter(openDatabase(this.config));
  }

  async connectToShadowDb(): Promise<SqlDriverAdapter> {
    return new BunSqliteAdapter(openDatabase({ ...this.config, url: ":memory:" }));
  }
}
