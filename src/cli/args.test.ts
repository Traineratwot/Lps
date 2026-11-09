import { describe, expect, test } from "bun:test";
import { flagBool, flagList, flagString, parseArgs } from "./args.ts";

function argv(...args: string[]): string[] {
  return ["bun", "lps", ...args];
}

describe("parseArgs", () => {
  test("command and positionals", () => {
    const r = parseArgs(argv("show", "git"));
    expect(r.command).toBe("show");
    expect(r.positionals).toEqual(["git"]);
  });

  test("boolean and value flags", () => {
    const r = parseArgs(argv("scan", "--only", "commands,docs", "--skip-docs"));
    expect(r.flags.only).toBe("commands,docs");
    expect(r.flags["skip-docs"]).toBe(true);
  });

  test("--key=value form", () => {
    const r = parseArgs(argv("list", "--type=flatpak"));
    expect(r.flags.type).toBe("flatpak");
  });

  test("short flags", () => {
    const r = parseArgs(argv("-h"));
    expect(r.flags.help).toBe(true);
  });

  test("-- stops flag parsing", () => {
    const r = parseArgs(argv("show", "--", "--not-a-flag"));
    expect(r.positionals).toEqual(["--not-a-flag"]);
  });
});

describe("flag helpers", () => {
  test("flagString / flagBool / flagList", () => {
    const r = parseArgs(argv("scan", "--users", "root,kirill", "--no-icons"));
    expect(flagString(r.flags, "users")).toBe("root,kirill");
    expect(flagList(r.flags, "users")).toEqual(["root", "kirill"]);
    expect(flagBool(r.flags, "no-icons")).toBe(true);
    expect(flagBool(r.flags, "missing")).toBe(false);
  });
});
