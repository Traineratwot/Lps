import { describe, expect, test } from "bun:test";
import { renderHelpPage } from "./docs.ts";

describe("renderHelpPage", () => {
  test("aliases report their expansion without executing anything", () => {
    const doc = renderHelpPage("ll", "", "alias", "ls -alF");
    expect(doc).toEqual({
      kind: "help",
      source: "alias",
      text: "ls -alF",
      truncated: false,
    });
  });

  test("empty alias expansion is still shown", () => {
    const doc = renderHelpPage("x", "", "alias", "");
    expect(doc?.text).toBe("(пусто)");
  });

  test("exec fallback runs --help and returns its text", () => {
    // coreutils `true` prints help for --help — documents real capture behavior
    const doc = renderHelpPage("true", "/bin/true", "exec", "");
    expect(doc?.kind).toBe("help");
    expect(doc?.source).toBe("--help");
    expect(doc?.text.length).toBeGreaterThan(0);
  });

  test("missing binary yields null", () => {
    expect(renderHelpPage("nope", "/nonexistent-binary", "exec", "")).toBeNull();
  });
});
