import { describe, expect, test } from "bun:test";
import { cleanExec, execCommandName, firstLine, stripAnsi } from "./text.ts";

describe("stripAnsi", () => {
  test("removes color codes and backspaces", () => {
    expect(stripAnsi("\x1b[1mBold\x1b[22m")).toBe("Bold");
    expect(stripAnsi("a\x08b")).toBe("ab");
    expect(stripAnsi("plain")).toBe("plain");
  });
});

describe("firstLine", () => {
  test("takes first non-empty trimmed line", () => {
    expect(firstLine("\n\n  hello world  \nsecond")).toBe("hello world");
  });

  test("truncates long lines with ellipsis", () => {
    const out = firstLine("x".repeat(300), 50);
    expect(out.length).toBe(50);
    expect(out.endsWith("…")).toBe(true);
  });

  test("empty input", () => {
    expect(firstLine("")).toBe("");
  });
});

describe("cleanExec", () => {
  test("strips desktop entry field codes", () => {
    expect(cleanExec("firefox %u")).toBe("firefox");
    expect(cleanExec("app %F --new")).toBe("app --new");
    expect(cleanExec("app %i %c %k")).toBe("app");
  });

  test("keeps literal %% as %", () => {
    expect(cleanExec("app --opt=%%value")).toBe("app --opt=%value");
  });
});

describe("execCommandName", () => {
  test("plain command", () => {
    expect(execCommandName("git %f")).toBe("git");
  });

  test("absolute path with quotes", () => {
    expect(execCommandName('"/opt/my app/run" %u')).toBe("/opt/my app/run");
    expect(execCommandName("'/opt/x/run' %u")).toBe("/opt/x/run");
  });

  test("absolute path without quotes", () => {
    expect(execCommandName("/usr/bin/firefox %u")).toBe("/usr/bin/firefox");
  });

  test("empty", () => {
    expect(execCommandName("")).toBe("");
  });
});
