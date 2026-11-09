import { describe, expect, test } from "bun:test";
import type { RawCommand } from "../../core/types.ts";
import { mergeCommands } from "./merge.ts";

function raw(partial: Partial<RawCommand> & { name: string; kind: RawCommand["kind"] }): RawCommand {
  return {
    path: "",
    realPath: "",
    aliasOf: "",
    source: partial.kind === "alias" ? "alias" : partial.kind === "builtin" ? "builtin" : "path",
    isSymlink: false,
    size: 100,
    mode: 0o755,
    ownerId: 0,
    dev: 1,
    ino: 1,
    mtimeMs: 1000,
    ...partial,
  };
}

// hash by file identity (dev:ino) — simulates content hashing for tests
const byIno = (r: RawCommand): string | null => {
  if (r.kind === "alias") return `alias:${r.name}`;
  if (r.kind === "builtin" || !r.path) return `builtin:${r.name}`;
  return `file:${r.dev}:${r.ino}`;
};

describe("mergeCommands", () => {
  test("usrmerge: /bin/curl and /usr/bin/curl collapse into one record (P?)", () => {
    const merged = mergeCommands(
      [
        raw({ name: "curl", kind: "exec", path: "/bin/curl", realPath: "/usr/bin/curl", dev: 1, ino: 10 }),
        raw({ name: "curl", kind: "exec", path: "/usr/bin/curl", realPath: "/usr/bin/curl", dev: 1, ino: 10 }),
      ],
      byIno,
    );
    expect(merged.length).toBe(1);
    const c = merged[0]!;
    expect(c.name).toBe("curl");
    expect(c.names).toEqual(["curl"]);
    expect(c.paths).toEqual(["/usr/bin/curl", "/bin/curl"]); // realPath first
    expect(c.hash).toBe("file:1:10");
  });

  test("same content, different names: one record, primary name from realPath", () => {
    const merged = mergeCommands(
      [
        raw({ name: "bat", kind: "exec", path: "/usr/bin/bat", realPath: "/usr/bin/bat", dev: 1, ino: 20 }),
        raw({ name: "batcat", kind: "exec", path: "/usr/bin/batcat", realPath: "/usr/bin/batcat", dev: 1, ino: 20 }),
      ],
      byIno,
    );
    expect(merged.length).toBe(1);
    expect(merged[0]!.names.sort()).toEqual(["bat", "batcat"]);
    expect(["bat", "batcat"]).toContain(merged[0]!.name);
  });

  test("different content stays separate even with the same name", () => {
    const merged = mergeCommands(
      [
        raw({ name: "python3", kind: "exec", path: "/usr/bin/python3", realPath: "/usr/bin/python3", ino: 30 }),
        raw({ name: "python3", kind: "exec", path: "/opt/bin/python3", realPath: "/opt/bin/python3", ino: 31, dev: 2 }),
      ],
      byIno,
    );
    expect(merged.length).toBe(2);
  });

  test("aliases attach to the command they invoke", () => {
    const merged = mergeCommands(
      [
        raw({ name: "ls", kind: "exec", path: "/bin/ls", realPath: "/usr/bin/ls", ino: 40 }),
        raw({ name: "ll", kind: "alias", aliasOf: "ls -alF" }),
        raw({ name: "ls", kind: "alias", aliasOf: "ls --color=auto" }),
      ],
      byIno,
    );
    expect(merged.length).toBe(1);
    expect(merged[0]!.aliases.sort()).toEqual(["ll=ls -alF", "ls=ls --color=auto"]);
  });

  test("aliases pointing to builtins merge into the builtin record", () => {
    const merged = mergeCommands(
      [
        raw({ name: "cd", kind: "builtin" }),
        raw({ name: "c", kind: "alias", aliasOf: "cd /tmp" }),
      ],
      byIno,
    );
    expect(merged.length).toBe(1);
    expect(merged[0]!.kind).toBe("builtin");
    expect(merged[0]!.aliases).toEqual(["c=cd /tmp"]);
  });

  test("unresolvable aliases stay standalone", () => {
    const merged = mergeCommands(
      [raw({ name: "foo", kind: "alias", aliasOf: "nonexistent --x" })],
      byIno,
    );
    expect(merged.length).toBe(1);
    expect(merged[0]!.kind).toBe("alias");
    expect(merged[0]!.aliases).toEqual(["foo=nonexistent --x"]);
  });

  test("exec wins over alternative kind when merged", () => {
    const merged = mergeCommands(
      [
        raw({ name: "editor", kind: "alternative", path: "/etc/alternatives/editor", realPath: "/usr/bin/vim.basic", ino: 50 }),
        raw({ name: "vim.basic", kind: "exec", path: "/usr/bin/vim.basic", realPath: "/usr/bin/vim.basic", ino: 50 }),
      ],
      byIno,
    );
    expect(merged.length).toBe(1);
    expect(merged[0]!.kind).toBe("exec");
    expect(merged[0]!.names.sort()).toEqual(["editor", "vim.basic"]);
    expect(merged[0]!.name).toBe("vim.basic"); // basename(realPath)
  });

  test("unreadable files are dropped", () => {
    const merged = mergeCommands(
      [raw({ name: "gone", kind: "exec", path: "/x/gone", realPath: "/x/gone", ino: 60 })],
      () => null,
    );
    // files with no hash fall through... exec raws with null hash are dropped
    expect(merged.length).toBe(0);
  });
});
