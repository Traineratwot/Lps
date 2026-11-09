import { describe, expect, test } from "bun:test";
import { parseAliases } from "./aliases.ts";

describe("parseAliases", () => {
  test("single and double quoted definitions", () => {
    const out = parseAliases(
      "alias ll='ls -alF'\nalias gs=\"git status\"\nalias la=ls",
      "alias",
    );
    expect(out.length).toBe(3);
    expect(out[0]).toMatchObject({ name: "ll", aliasOf: "ls -alF", kind: "alias" });
    expect(out[1]).toMatchObject({ name: "gs", aliasOf: "git status" });
    expect(out[2]).toMatchObject({ name: "la", aliasOf: "ls" });
  });

  test("ignores non-alias lines and comments", () => {
    const out = parseAliases(
      "# alias commented='no'\nexport X=1\nalias go='cd /tmp'\necho alias fake='no'",
      "alias",
    );
    expect(out.length).toBe(1);
    expect(out[0]!.name).toBe("go");
  });

  test("skips empty values", () => {
    expect(parseAliases("alias x=", "alias").length).toBe(0);
  });

  test("name charset allows dots and dashes", () => {
    const out = parseAliases("alias my.tool-1='x'", "alias");
    expect(out[0]!.name).toBe("my.tool-1");
  });

  test("source field is recorded", () => {
    const out = parseAliases("alias a='b'", "alias");
    expect(out[0]!.source).toBe("alias");
    expect(out[0]!.path).toBe("");
    expect(out[0]!.kind).toBe("alias");
  });
});
