import { existsSync, readFileSync } from "node:fs";
import type { RawPackage } from "../types.ts";

export type DpkgIndex = {
  /** All installed packages keyed by name. */
  byName: Map<string, RawPackage>;
  /** File path → package name (from /var/lib/dpkg/info/<pkg>.list). */
  byPath: Map<string, string>;
};

const STATUS_PATH = "/var/lib/dpkg/status";
const INFO_DIR = "/var/lib/dpkg/info";

/** Parses one RFC822-style stanza from dpkg status. */
function parseStanza(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let current = "";
  for (const line of block.split(/\r?\n/)) {
    if (/^\s/.test(line) && current) {
      fields[current] += `\n${line.trim()}`;
      continue;
    }
    const sep = line.indexOf(":");
    if (sep <= 0) continue;
    current = line.slice(0, sep).trim();
    fields[current] = line.slice(sep + 1).trim();
  }
  return fields;
}

function toRawPackage(fields: Record<string, string>): RawPackage | null {
  const name = fields["Package"];
  const status = fields["Status"] ?? "";
  if (!name || !status.includes("installed")) return null;
  const description = fields["Description"] ?? "";
  return {
    type: "deb",
    name,
    version: fields["Version"] ?? "",
    architecture: fields["Architecture"] ?? "",
    status,
    maintainer: fields["Maintainer"] ?? "",
    // first line is the short description
    description: description.split("\n")[0] ?? "",
    section: fields["Section"] ?? "",
    origin: "",
    installPath: "",
    meta: {
      priority: fields["Priority"] ?? "",
      source: fields["Source"] ?? "",
      homepage: fields["Homepage"] ?? "",
      installedSize: fields["Installed-Size"] ?? "",
    },
  };
}

/** Reads installed deb packages from /var/lib/dpkg/status. */
export function listDebPackages(): RawPackage[] {
  if (!existsSync(STATUS_PATH)) return [];
  const content = readFileSync(STATUS_PATH, "utf8");
  const result: RawPackage[] = [];
  for (const block of content.split(/\n\n+/)) {
    const pkg = toRawPackage(parseStanza(block));
    if (pkg) result.push(pkg);
  }
  return result;
}

/**
 * Builds the path→package index from /var/lib/dpkg/info/<pkg>.list.
 * In-memory only — too large to store in the database (~400k rows on a
 * typical desktop).
 */
export function buildDpkgPathIndex(packages: RawPackage[]): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const pkg of packages) {
    const listPath = `${INFO_DIR}/${pkg.name}.list`;
    if (!existsSync(listPath)) continue;
    let content: string;
    try {
      content = readFileSync(listPath, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      const path = line.trim();
      if (path && !byPath.has(path)) byPath.set(path, pkg.name);
    }
  }
  return byPath;
}

export function loadDpkgIndex(): DpkgIndex {
  const packages = listDebPackages();
  const byName = new Map(packages.map((p) => [p.name, p]));
  const byPath = buildDpkgPathIndex(packages);
  return { byName, byPath };
}

/** Fallback lookup via `dpkg -S` for paths outside the .list files. */
export function dpkgSearchFile(path: string): string | null {
  const proc = Bun.spawnSync(["dpkg", "-S", path], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  if (proc.exitCode !== 0) return null;
  const out = proc.stdout?.toString() ?? "";
  // "pkg: /path" or "diversion by pkg1 from: /path"
  const m = out.match(/^([^\s:]+):\s/);
  return m ? m[1]! : null;
}
