import { existsSync, readFileSync } from "node:fs";
import type { RawCommand } from "../../../core/types.ts";
import { runCommand } from "../../../core/util/exec.ts";
import { listDir, readLinkOrNull, realPathOr } from "../../../core/util/fs.ts";

/**
 * Debian alternatives: virtual names (editor, x-www-browser, ...) mapped to
 * concrete implementations via /etc/alternatives symlinks.
 */
export function scanAlternatives(): RawCommand[] {
  const result: RawCommand[] = [];
  const seen = new Set<string>();

  const push = (name: string, path: string): void => {
    // man-page alternatives (foo.1.gz, foo.8.gz) are not commands
    if (/\.\d+\.gz$/.test(name) || name.endsWith(".gz")) return;
    if (seen.has(name)) return;
    seen.add(name);
    result.push({
      name,
      kind: "alternative",
      path,
      realPath: realPathOr(path),
      aliasOf: "",
      source: "alternatives",
      isSymlink: true,
      size: null,
      mode: null,
      ownerId: null,
    });
  };

  // Primary source: the alternatives directory itself.
  const altDir = "/etc/alternatives";
  if (existsSync(altDir)) {
    for (const name of listDir(altDir)) {
      const link = `${altDir}/${name}`;
      if (!readLinkOrNull(link)) continue;
      push(name, link);
    }
  }

  // Secondary: update-alternatives output (catches registered but unused names).
  if (Bun.which("update-alternatives")) {
    const res = runCommand(["update-alternatives", "--get-selections"], { timeoutMs: 5000 });
    if (res.ok) {
      for (const line of res.stdout.split(/\r?\n/)) {
        const parts = line.split(/\s+/);
        if (parts.length < 3) continue;
        const [name, , path] = parts as [string, string, string];
        if (!name || !path) continue;
        push(name, path);
      }
    }
  }

  return result;
}

/** Reads dpkg info lists dir (exposed for the debian module). */
export function dpkgInfoDir(): string {
  return "/var/lib/dpkg/info";
}

export function readDpkgStatus(): string {
  return readFileSync("/var/lib/dpkg/status", "utf8");
}
