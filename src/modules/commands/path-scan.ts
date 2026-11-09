import { isAbsolute, resolve } from "node:path";
import type { RawCommand } from "../../core/types.ts";
import { isExecutableFile, listDir, statEntry } from "../../core/util/fs.ts";
import { userHomeDirs } from "../../core/util/users.ts";

/** Extra directories that export commands even when not on PATH. */
const EXPORT_DIRS = [
  "/snap/bin",
  "/var/lib/flatpak/exports/bin",
  "/var/lib/snapd/desktop/bin",
];

function pathDirs(): string[] {
  const fromEnv = (process.env.PATH ?? "")
    .split(":")
    .map((d) => d.trim())
    .filter(Boolean);
  const system = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"];
  const seen = new Set<string>();
  const dirs: string[] = [];
  const perUser = userHomeDirs().flatMap((home) => [
    resolve(home, ".local/bin"),
    resolve(home, ".local/share/flatpak/exports/bin"),
  ]);
  for (const dir of [...fromEnv, ...system, ...EXPORT_DIRS, ...perUser]) {
    const abs = isAbsolute(dir) ? dir : resolve(dir);
    if (!seen.has(abs)) {
      seen.add(abs);
      dirs.push(abs);
    }
  }
  return dirs;
}

/**
 * Scans PATH (and export dirs) for executable files.
 * Duplicate names across dirs become separate rows — priority is dir order.
 */
export function scanPathCommands(): RawCommand[] {
  const result: RawCommand[] = [];
  for (const dir of pathDirs()) {
    for (const name of listDir(dir)) {
      const info = statEntry(`${dir}/${name}`);
      if (!info || !isExecutableFile(info)) continue;
      result.push({
        name: info.name,
        kind: "exec",
        path: info.path,
        realPath: info.realPath,
        aliasOf: "",
        source: "path",
        isSymlink: info.isSymlink,
        size: info.size,
        mode: info.mode,
        ownerId: info.ownerId,
      });
    }
  }
  return result;
}
