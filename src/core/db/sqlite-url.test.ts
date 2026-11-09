import { describe, expect, test } from "bun:test";
import { normalizeSqliteUrl, sqlitePath } from "./sqlite-url.ts";

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

describe("normalizeSqliteUrl", () => {
  const cwd = "/home/user/project";

  test("relative forms become absolute file:// URLs", () => {
    expect(normalizeSqliteUrl("file:./dev.db", cwd)).toBe("file:///home/user/project/dev.db");
    expect(normalizeSqliteUrl("file://./dev.db", cwd)).toBe("file:///home/user/project/dev.db");
    expect(normalizeSqliteUrl("./dev.db", cwd)).toBe("file:///home/user/project/dev.db");
    expect(normalizeSqliteUrl("dev.db", cwd)).toBe("file:///home/user/project/dev.db");
  });

  test("absolute forms pass through", () => {
    expect(normalizeSqliteUrl("file:///tmp/x.db", cwd)).toBe("file:///tmp/x.db");
    expect(normalizeSqliteUrl("/tmp/x.db", cwd)).toBe("file:///tmp/x.db");
    expect(normalizeSqliteUrl("file://localhost/tmp/x.db", cwd)).toBe("file:///tmp/x.db");
  });

  test(":memory: survives", () => {
    expect(normalizeSqliteUrl(":memory:", cwd)).toBe(":memory:");
  });
});
