import { describe, expect, test } from "bun:test";
import { isDangerousHelpCommand } from "./safety.ts";
import { getHelpSummary } from "./help.ts";

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

describe("getHelpSummary guard", () => {
  test("refuses to execute dangerous commands (no help collected)", () => {
    // returns null before any spawn — safe to call in tests
    expect(getHelpSummary("reboot", "/sbin/reboot", "exec")).toBeNull();
    expect(getHelpSummary("shutdown", "/sbin/shutdown", "exec")).toBeNull();
    expect(getHelpSummary("mkfs.ext4", "/sbin/mkfs.ext4", "exec")).toBeNull();
  });
});
