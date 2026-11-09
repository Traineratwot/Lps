import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

/**
 * sha256 of a file's content — the identity of a command binary.
 * Returns null when the file cannot be read.
 */
export function hashFile(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/** Identity for entities that are not files (alias, builtin). */
export function syntheticHash(kind: string, name: string): string {
  return createHash("sha256").update(`${kind}:${name}`).digest("hex");
}

/** Cache key of a file on disk — same key means the hash is still valid. */
export function fileKey(dev: number, ino: number, size: number, mtimeMs: number): string {
  return `${dev}:${ino}:${size}:${mtimeMs}`;
}

export function fileKeyOfPath(path: string): string | null {
  try {
    const st = statSync(path); // follows symlinks — identity of the content
    return fileKey(Number(st.dev), Number(st.ino), st.size, Math.round(st.mtimeMs));
  } catch {
    return null;
  }
}
