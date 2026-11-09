import type { CommandKind, RawCommand } from "../../core/types.ts";
import { syntheticHash } from "../../core/util/hash.ts";

/**
 * A command as stored: one row per unique file content (or per
 * alias/builtin name). Paths and names collapse into arrays.
 */
export type MergedCommand = {
  /** sha256 of the file content, or synthetic hash for alias/builtin. */
  hash: string;
  /** Primary name (basename of the real path when known, else first seen). */
  name: string;
  /** All distinct names, primary first. */
  names: string[];
  /** All filesystem paths, realPath first; [] for alias/builtin. */
  paths: string[];
  /** Alias definitions "name=expansion" resolving to this command. */
  aliases: string[];
  kind: CommandKind;
  source: string;
  realPath: string;
  isSymlink: boolean;
  size: number | null;
  mode: number | null;
  ownerId: number | null;
  dev: number | null;
  inode: number | null;
  mtimeMs: number | null;
};

/** Looks up (and caches) the content hash for a raw command. */
export type HashFn = (raw: RawCommand) => string | null;

function uniquePreserveOrder(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function firstToken(text: string): string {
  return text.trim().split(/\s+/)[0] ?? "";
}

/**
 * Collapses raw commands into unique entries keyed by file-content hash.
 * File commands (exec/alternative) merge across paths; aliases attach to
 * the command they invoke; builtins and unresolvable aliases stay standalone.
 */
export function mergeCommands(raws: RawCommand[], hashOf: HashFn): MergedCommand[] {
  const byHash = new Map<string, MergedCommand>();
  const aliasRaws: RawCommand[] = [];
  const order: string[] = [];

  const touch = (hash: string): void => {
    if (!byHash.has(hash)) order.push(hash);
  };

  // pass 1: files and builtins
  for (const raw of raws) {
    if (raw.kind === "alias") {
      aliasRaws.push(raw);
      continue;
    }
    if (raw.kind === "builtin" || !raw.path) {
      const hash = hashOf(raw) ?? syntheticHash("builtin", raw.name);
      touch(hash);
      const existing = byHash.get(hash);
      if (existing) {
        existing.names = uniquePreserveOrder([...existing.names, raw.name]);
        continue;
      }
      byHash.set(hash, {
        hash,
        name: raw.name,
        names: [raw.name],
        paths: [],
        aliases: [],
        kind: "builtin",
        source: raw.source,
        realPath: "",
        isSymlink: false,
        size: null,
        mode: null,
        ownerId: null,
        dev: null,
        inode: null,
        mtimeMs: null,
      });
      continue;
    }

    const hash = hashOf(raw);
    if (hash === null) continue; // unreadable file — drop
    touch(hash);
    const existing = byHash.get(hash);
    if (existing) {
      existing.names = uniquePreserveOrder([...existing.names, raw.name]);
      existing.paths = uniquePreserveOrder([...existing.paths, raw.path]);
      if (!existing.realPath && raw.realPath) existing.realPath = raw.realPath;
      if (raw.kind === "exec") existing.kind = "exec";
      existing.isSymlink = existing.isSymlink || raw.isSymlink;
      continue;
    }
    byHash.set(hash, {
      hash,
      name: raw.name,
      names: [raw.name],
      paths: [raw.path],
      aliases: [],
      kind: raw.kind,
      source: raw.source,
      realPath: raw.realPath || raw.path,
      isSymlink: raw.isSymlink,
      size: raw.size,
      mode: raw.mode,
      ownerId: raw.ownerId,
      dev: raw.dev,
      inode: raw.ino,
      mtimeMs: raw.mtimeMs,
    });
  }

  // pass 2: aliases attach to the command they invoke
  const byName = new Map<string, MergedCommand>();
  for (const hash of order) {
    const rec = byHash.get(hash)!;
    for (const n of rec.names) if (!byName.has(n)) byName.set(n, rec);
    if (!byName.has(rec.name)) byName.set(rec.name, rec);
  }

  for (const raw of aliasRaws) {
    const def = `${raw.name}=${raw.aliasOf}`;
    const target = byName.get(firstToken(raw.aliasOf)) ?? byName.get(raw.name);
    if (target) {
      target.aliases = uniquePreserveOrder([...target.aliases, def]);
      continue;
    }
    const hash = hashOf(raw) ?? syntheticHash("alias", raw.name);
    touch(hash);
    byHash.set(hash, {
      hash,
      name: raw.name,
      names: [raw.name],
      paths: [],
      aliases: [def],
      kind: "alias",
      source: raw.source,
      realPath: "",
      isSymlink: false,
      size: null,
      mode: null,
      ownerId: null,
      dev: null,
      inode: null,
      mtimeMs: null,
    });
    byName.set(raw.name, byHash.get(hash)!);
  }

  // deterministic presentation: primary name prefers basename(realPath),
  // skipping symbol applet names like "[" in favor of word-like ones
  const wordLike = /^[A-Za-z][A-Za-z0-9._+-]*$/;
  const result: MergedCommand[] = [];
  for (const hash of order) {
    const rec = byHash.get(hash)!;
    const candidates = uniquePreserveOrder(rec.names);
    if (rec.realPath) {
      const base = rec.realPath.split("/").pop() ?? "";
      if (base && candidates.includes(base) && wordLike.test(base)) {
        rec.name = base;
      } else {
        rec.name = candidates.find((n) => wordLike.test(n)) ?? candidates[0] ?? rec.name;
      }
    } else {
      rec.name = candidates.slice().sort((a, b) => a.localeCompare(b))[0] ?? rec.name;
    }
    const rest = rec.paths.filter((p) => p !== rec.realPath).sort((a, b) => a.localeCompare(b));
    rec.paths = rec.realPath ? [rec.realPath, ...rest] : rest;
    rec.names = uniquePreserveOrder([rec.name, ...candidates]);
    rec.aliases.sort((a, b) => a.localeCompare(b));
    result.push(rec);
  }
  return result;
}
