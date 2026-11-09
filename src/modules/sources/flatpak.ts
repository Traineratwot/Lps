import { existsSync, readdirSync, readlinkSync, statSync } from "node:fs";
import type { RawPackage } from "../distro/types.ts";
import { runCommand } from "../../core/util/exec.ts";

const EXPORT_BIN_DIRS = [
  "/var/lib/flatpak/exports/bin",
  "/var/lib/snapd/desktop/bin",
];

function available(): boolean {
  return Bun.which("flatpak") !== null;
}

function listExportBinDirs(): string[] {
  return EXPORT_BIN_DIRS.filter((dir) => existsSync(dir));
}

/** Installed flatpak applications (runtimes excluded). */
export async function listFlatpakPackages(): Promise<RawPackage[]> {
  if (!available()) return [];
  const res = runCommand(
    [
      "flatpak", "list", "--app",
      "--columns=application,name,version,branch,origin,installation,arch,description",
    ],
    { timeoutMs: 15000 },
  );
  if (!res.ok) return [];

  const result: RawPackage[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [id, name, version, branch, origin, installation, arch, ...descParts] = line.split("\t");
    if (!id) continue;
    result.push({
      type: "flatpak",
      name: id,
      version: version ?? "",
      architecture: arch ?? "",
      status: "installed",
      maintainer: "",
      description: descParts.join("\t"),
      section: branch ?? "",
      origin: origin ?? "",
      installPath: installation ?? "",
      meta: { displayName: name ?? "", branch, installation },
    });
  }
  return result;
}

/**
 * Paths of flatpak-exported binaries → app-id.
 * Covers both the export symlink and its resolved target.
 */
export async function flatpakPathIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for (const dir of listExportBinDirs()) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const link = `${dir}/${entry}`;
      const appId = appIdFromPath(link) ?? entry;
      index.set(link, appId);
      try {
        const target = readlinkSync(link);
        const abs = target.startsWith("/") ? target : `${dir}/${target}`;
        index.set(abs, appId);
        // also record the resolved realpath chain
        const st = statSync(link); // follows
        if (st) index.set(link, appId);
      } catch {
        // not a symlink or broken — entry name is still the app id
      }
    }
  }
  return index;
}

/** Extracts an app id from a flatpak path (…/app/<id>/… or exports/bin/<id>). */
export function appIdFromPath(path: string): string | null {
  const appMatch = path.match(/\/app\/([^/]+)\/current\//);
  if (appMatch) return appMatch[1]!;
  const exportMatch = path.match(/\/exports\/bin\/([^/]+)$/);
  if (exportMatch) return exportMatch[1]!;
  return null;
}
