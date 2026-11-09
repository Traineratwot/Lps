import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawCommand } from "../../core/types.ts";
import { listUsers } from "../../core/util/users.ts";

const ALIAS_RE = /^\s*alias\s+([A-Za-z0-9_.:-]+)=(['"])(.*?)\2\s*$/;
const ALIAS_UNQUOTED_RE = /^\s*alias\s+([A-Za-z0-9_.:-]+)=(\S+)\s*$/;

export function parseAliases(content: string, source: string): RawCommand[] {
  const result: RawCommand[] = [];
  for (const line of content.split(/\r?\n/)) {
    const quoted = line.match(ALIAS_RE);
    const unquoted = quoted ? null : line.match(ALIAS_UNQUOTED_RE);
    const match = quoted ?? unquoted;
    if (!match) continue;
    const name = match[1]!;
    const value = match[3] ?? match[2] ?? "";
    if (!value) continue;
    result.push({
      name,
      kind: "alias",
      path: "",
      realPath: "",
      aliasOf: value,
      source,
      isSymlink: false,
      size: null,
      mode: null,
      ownerId: null,
      dev: null,
      ino: null,
      mtimeMs: null,
    });
  }
  return result;
}

function homeFor(user: string): string {
  const fromPasswd = listUsers().find((u) => u.name === user)?.home;
  if (fromPasswd) return fromPasswd;
  return user === "root" ? "/root" : join("/home", user);
}

function rcFilesFor(user: string): string[] {
  const base = homeFor(user);
  return [
    "/etc/bash.bashrc",
    "/etc/profile",
    "/etc/zsh/zshrc",
    join(base, ".bashrc"),
    join(base, ".bash_aliases"),
    join(base, ".profile"),
    join(base, ".zshrc"),
    join(base, ".zshenv"),
    join(base, ".config/fish/config.fish"),
  ];
}

/**
 * Parses `alias name=...` definitions from shell rc files.
 * Users come from config (default: current user).
 */
export function scanAliases(users: string[]): RawCommand[] {
  const seen = new Set<string>();
  const result: RawCommand[] = [];
  for (const user of users) {
    for (const file of rcFilesFor(user)) {
      if (!existsSync(file)) continue;
      let content: string;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const entry of parseAliases(content, "alias")) {
        const key = `${user}:${entry.name}`;
        if (seen.has(key)) continue; // first definition wins (file order)
        seen.add(key);
        result.push(entry);
      }
    }
  }
  return result;
}
