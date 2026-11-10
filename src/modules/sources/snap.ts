import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { RawPackage } from "../distro/types.ts";
import { runCommand } from "../../core/util/exec.ts";

const SNAP_BIN_DIRS = ["/snap/bin", "/var/lib/snapd/snap/bin"];
const SNAP_DESKTOP_DIRS = ["/var/lib/snapd/desktop/applications"];
const SNAP_ROOTS = ["/snap", "/var/lib/snapd/snap"];

function available(): boolean {
  return Bun.which("snap") !== null;
}

/**
 * Parses `snap list` output (header row + whitespace-padded columns):
 *   Name  Version  Rev  Tracking  Publisher  Notes
 */
export function parseSnapList(output: string): RawPackage[] {
  const result: RawPackage[] = [];
  const lines = output.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed || /^Name\s+Version/.test(trimmed)) continue;
    const cols = trimmed.split(/\s{2,}/);
    if (cols.length < 2) continue;
    const [name, version = "", rev = "", tracking = "", publisher = "", notes = ""] = cols;
    if (!name) continue;
    result.push({
      type: "snap",
      name,
      version,
      architecture: "",
      status: tracking || "installed",
      maintainer: (publisher ?? "").replace(/\*+$/, ""),
      description: "",
      section: notes === "-" ? "" : notes,
      origin: tracking,
      installPath: "",
      meta: { rev, notes, publisherRaw: publisher ?? "" },
    });
  }
  return result;
}

function snapYaml(name: string): string | null {
  for (const root of SNAP_ROOTS) {
    const yamlPath = `${root}/${name}/current/meta/snap.yaml`;
    if (!existsSync(yamlPath)) continue;
    try {
      return readFileSync(yamlPath, "utf8");
    } catch {
      // try the next root
    }
  }
  return null;
}

/** App names exported by a snap (`apps:` keys of meta/snap.yaml). */
export function parseSnapApps(yamlText: string): string[] {
  const apps: string[] = [];
  let inApps = false;
  for (const line of yamlText.split(/\r?\n/)) {
    if (/^apps:\s*$/.test(line)) {
      inApps = true;
      continue;
    }
    if (inApps) {
      if (/^\S/.test(line)) break; // next top-level key
      // app keys sit at 2-space indent; nested keys (command:, plugs:) deeper
      const m = line.match(/^ {2}([A-Za-z0-9._-]+):/);
      if (m) apps.push(m[1]!);
    }
  }
  return apps;
}

/** `description:` from the snap's meta/snap.yaml (block or inline form). */
export function parseSnapDescription(yamlText: string): string {
  const block = yamlText.match(/^description:\s*[|>][-+]?\s*\n((?:[ \t]+.*\n?)*)/m);
  if (block) {
    return (block[1] ?? "").replace(/\n[ \t]+/g, " ").trim().replace(/^["']|["']$/g, "");
  }
  const inline = yamlText.match(/^description:\s*(.+)$/m);
  return (inline?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

/** Installed snaps via `snap list`, descriptions from meta/snap.yaml. */
export async function listSnapPackages(): Promise<RawPackage[]> {
  if (!available()) return [];
  const res = runCommand(["snap", "list"], { timeoutMs: 15000 });
  if (!res.ok && !res.stdout.trim()) return [];
  const pkgs = parseSnapList(res.stdout);
  for (const pkg of pkgs) {
    const yaml = snapYaml(pkg.name);
    if (yaml) pkg.description = parseSnapDescription(yaml) || pkg.description;
    for (const root of SNAP_ROOTS) {
      if (existsSync(`${root}/${pkg.name}/current`)) {
        pkg.installPath = `${root}/${pkg.name}/current`;
        break;
      }
    }
  }
  return pkgs;
}

/**
 * Snap-owned paths → snap name:
 * - exported command wrappers in /snap/bin (symlink name, resolved through
 *   the snap's `apps:` list — the link target itself is /usr/bin/snap);
 * - exported .desktop files (`<snap>_<app>.desktop`).
 */
export async function snapPathIndex(snapNames: string[]): Promise<Map<string, string>> {
  const index = new Map<string, string>();

  for (const name of snapNames) {
    const yaml = snapYaml(name);
    if (!yaml) continue;
    for (const app of parseSnapApps(yaml)) {
      for (const dir of SNAP_BIN_DIRS) {
        const wrapper = `${dir}/${app}`;
        if (existsSync(wrapper)) index.set(wrapper, name);
      }
    }
  }

  for (const dir of SNAP_DESKTOP_DIRS) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const m = entry.match(/^([^_]+)_.*\.desktop$/);
      if (m && snapNames.includes(m[1]!)) index.set(`${dir}/${entry}`, m[1]!);
    }
  }
  return index;
}
