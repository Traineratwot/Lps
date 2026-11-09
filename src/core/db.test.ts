import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, ensureSchema, type Db } from "./db.ts";
import { BunSqliteAdapterFactory, sqlitePath } from "./db/bun-sqlite-adapter.ts";

describe("sqlitePath", () => {
  test("passes plain paths and :memory: through", () => {
    expect(sqlitePath(":memory:")).toBe(":memory:");
    expect(sqlitePath("/var/lib/lps/lps.db")).toBe("/var/lib/lps/lps.db");
    expect(sqlitePath("./dev.db")).toBe("./dev.db");
  });

  test("handles both file: forms (studio#1578 regression)", () => {
    expect(sqlitePath("file:./dev.db")).toBe("./dev.db");
    expect(sqlitePath("file://./dev.db")).toBe("./dev.db");
    expect(sqlitePath("file:///tmp/x.db")).toBe("/tmp/x.db");
    expect(sqlitePath("file://localhost/tmp/x.db")).toBe("/tmp/x.db");
  });
});

describe("bun:sqlite driver adapter", () => {
  const factory = new BunSqliteAdapterFactory({ url: ":memory:" });

  test("queryRaw and executeRaw round-trip", async () => {
    const adapter = await factory.connect();
    await adapter.executeScript("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    const inserted = await adapter.executeRaw({
      sql: "INSERT INTO t (name) VALUES (?)",
      args: ["hello"],
      argTypes: [{ scalarType: "string", arity: "scalar" }],
    });
    expect(inserted).toBe(1);

    const res = await adapter.queryRaw({
      sql: "SELECT id, name FROM t",
      args: [],
      argTypes: [],
    });
    expect(res.columnNames).toEqual(["id", "name"]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0]![1]).toBe("hello");
    await adapter.dispose();
  });

  test("maps constraint violations to typed errors", async () => {
    const adapter = await factory.connect();
    await adapter.executeScript("CREATE TABLE u (name TEXT UNIQUE)");
    const insert = (v: string) =>
      adapter.executeRaw({
        sql: "INSERT INTO u (name) VALUES (?)",
        args: [v],
        argTypes: [{ scalarType: "string", arity: "scalar" }],
      });
    await insert("a");
    await expect(insert("a")).rejects.toThrow(/UniqueConstraintViolation|constraint/i);
    await adapter.dispose();
  });

  test("transaction commit and rollback", async () => {
    const adapter = await factory.connect();
    await adapter.executeScript("CREATE TABLE tr (v INTEGER)");
    const tx = await adapter.startTransaction();
    await tx.executeRaw({ sql: "INSERT INTO tr VALUES (1)", args: [], argTypes: [] });
    await tx.rollback();

    const afterRollback = await adapter.queryRaw({ sql: "SELECT COUNT(*) FROM tr", args: [], argTypes: [] });
    expect(afterRollback.rows[0]![0]).toBe(0);

    const tx2 = await adapter.startTransaction();
    await tx2.executeRaw({ sql: "INSERT INTO tr VALUES (2)", args: [], argTypes: [] });
    await tx2.commit();
    const afterCommit = await adapter.queryRaw({ sql: "SELECT COUNT(*) FROM tr", args: [], argTypes: [] });
    expect(afterCommit.rows[0]![0]).toBe(1);
    await adapter.dispose();
  });
});

describe("schema + PrismaClient integration", () => {
  let dir: string;
  let dbPath: string;
  let db: Db;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lps-test-"));
    dbPath = join(dir, "test.db");
    await ensureSchema(dbPath);
    db = createDb(dbPath);
  });

  afterAll(async () => {
    await db.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("ensureSchema is idempotent", async () => {
    await ensureSchema(dbPath);
    await ensureSchema(dbPath);
    const meta = await db.meta.findUnique({ where: { key: "applied_migrations" } });
    expect(meta?.value).toContain("init");
  });

  test("command upsert with compound unique key", async () => {
    const create = {
      name: "git",
      kind: "exec",
      path: "/usr/bin/git",
      realPath: "/usr/bin/git",
      source: "path",
    };
    await db.command.upsert({
      where: { name_path_kind: { name: "git", path: "/usr/bin/git", kind: "exec" } },
      create,
      update: { realPath: "/usr/bin/git" },
    });
    await db.command.upsert({
      where: { name_path_kind: { name: "git", path: "/usr/bin/git", kind: "exec" } },
      create,
      update: { realPath: "/usr/bin/git-x" },
    });
    const rows = await db.command.findMany({ where: { name: "git" } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.realPath).toBe("/usr/bin/git-x");
  });

  test("alias and builtin with same name coexist (P4 regression)", async () => {
    await db.command.create({
      data: { name: "cd", kind: "builtin", source: "builtin" },
    });
    await db.command.create({
      data: { name: "cd", kind: "alias", source: "alias", aliasOf: "cd -" },
    });
    const rows = await db.command.findMany({ where: { name: "cd" } });
    expect(rows.length).toBe(2);
  });

  test("relations: command ↔ package ↔ doc", async () => {
    const pkg = await db.package.create({
      data: { type: "deb", name: "git", version: "1.0", description: "VCS" },
    });
    const cmd = await db.command.findFirst({ where: { name: "git" } });
    await db.command.update({ where: { id: cmd!.id }, data: { packageId: pkg.id } });
    await db.commandDoc.create({
      data: {
        commandId: cmd!.id,
        summary: "the stupid content tracker",
        manPath: "/usr/share/man/man1/git.1.gz",
        manSection: "1",
        source: "man",
      },
    });

    const full = await db.command.findFirst({
      where: { name: "git" },
      include: { package: true, doc: true },
    });
    expect(full?.package?.name).toBe("git");
    expect(full?.doc?.summary).toBe("the stupid content tracker");
  });

  test("process identity: (pid, startedAt) allows PID reuse", async () => {
    const startedA = new Date("2026-01-01T00:00:00Z");
    const startedB = new Date("2026-01-02T00:00:00Z");
    await db.process.create({
      data: { pid: 1234, startedAt: startedA, cmdline: "/old/proc", user: "root" },
    });
    await db.process.create({
      data: { pid: 1234, startedAt: startedB, cmdline: "/new/proc", user: "root" },
    });
    const rows = await db.process.findMany({ where: { pid: 1234 } });
    expect(rows.length).toBe(2);
  });

  test("snapshot cascade-deletes with ScanRun", async () => {
    const run = await db.scanRun.create({ data: { startedAt: new Date() } });
    const proc = await db.process.create({
      data: { pid: 9, startedAt: new Date("2026-01-03T00:00:00Z"), cmdline: "x", user: "root" },
    });
    await db.processSnapshot.create({
      data: {
        scanRunId: run.id,
        processId: proc.id,
        uptimeSec: 10,
        cpuPercent: 1,
        state: "S",
      },
    });
    await db.scanRun.delete({ where: { id: run.id } });
    const snaps = await db.processSnapshot.findMany({ where: { processId: proc.id } });
    expect(snaps.length).toBe(0);
  });
});
