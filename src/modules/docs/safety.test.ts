import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDangerousHelpCommand, isElfBinary } from "./safety.ts";
import { getHelpSummary } from "./help.ts";

const dir = mkdtempSync(join(tmpdir(), "lps-safety-"));
const elfPath = join(dir, "fake-elf");
const scriptPath = join(dir, "fake-script");
// minimal ELF magic; only the first 4 bytes are inspected
writeFileSync(elfPath, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]));
writeFileSync(scriptPath, "#!/bin/sh\nreboot\n");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("isDangerousHelpCommand", () => {
  test("flags the reboot/shutdown family", () => {
    for (const name of ["reboot", "shutdown", "halt", "poweroff", "telinit", "init"]) {
      expect(isDangerousHelpCommand(name)).toBe(true);
    }
  });

  test("flags disk and process killers, including by full path", () => {
    expect(isDangerousHelpCommand("/sbin/reboot")).toBe(true);
    expect(isDangerousHelpCommand("mkfs.ext4")).toBe(true);
    expect(isDangerousHelpCommand("fsck.fat")).toBe(true);
    expect(isDangerousHelpCommand("wipefs")).toBe(true);
    expect(isDangerousHelpCommand("pkill")).toBe(true);
    expect(isDangerousHelpCommand("userdel")).toBe(true);
    expect(isDangerousHelpCommand("lvremove")).toBe(true);
    expect(isDangerousHelpCommand("mount")).toBe(true);
  });

  test("leaves ordinary commands alone", () => {
    for (const name of ["git", "curl", "ls", "python3", "ffmpeg", "sudo"]) {
      expect(isDangerousHelpCommand(name)).toBe(false);
    }
    // name-only heuristics must not overfire
    expect(isDangerousHelpCommand("initdb")).toBe(false);
    expect(isDangerousHelpCommand("shutdown-helper")).toBe(false);
    expect(isDangerousHelpCommand("installer")).toBe(false);
  });
});

describe("isElfBinary", () => {
  test("detects ELF magic and rejects scripts", () => {
    expect(isElfBinary(elfPath)).toBe(true);
    expect(isElfBinary(scriptPath)).toBe(false);
    expect(isElfBinary("/nonexistent")).toBe(false);
    // system binaries are ELF
    expect(isElfBinary("/bin/sh")).toBe(true);
  });
});

describe("getHelpSummary guard", () => {
  test("refuses to execute dangerous commands (no help collected)", () => {
    // returns null before any spawn — safe to call in tests
    expect(getHelpSummary("reboot", "/sbin/reboot", "exec")).toBeNull();
    expect(getHelpSummary("shutdown", "/sbin/shutdown", "exec")).toBeNull();
    expect(getHelpSummary("mkfs.ext4", "/sbin/mkfs.ext4", "exec")).toBeNull();
  });

  test("refuses to execute scripts (rename-user regression: script body ran on --help)", () => {
    // the script content is `reboot` — if this were executed the test box dies;
    // the guard must return before any spawn
    expect(getHelpSummary("fake-script", scriptPath, "exec")).toBeNull();
  });
});
