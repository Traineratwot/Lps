import { lstatSync, readlinkSync, realpathSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export type EntryInfo = {
  name: string;
  path: string;
  realPath: string;
  isSymlink: boolean;
  size: number;
  mode: number;
  ownerId: number;
  isDir: boolean;
  /** Device id and inode — identify the file without reading it. */
  dev: number;
  ino: number;
  mtimeMs: number;
};

/** Lists immediate children of a directory; missing dir → empty array. */
export function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Stats a path entry; returns null when missing or unreadable. */
export function statEntry(path: string): EntryInfo | null {
  try {
    const st = lstatSync(path);
    const isSymlink = st.isSymbolicLink();
    // realPath is always canonical: with usrmerge /bin/git is a regular file
    // (not a symlink), yet its canonical location is /usr/bin/git — dpkg
    // lists the canonical path, so linking needs it.
    const realPath = realPathOr(path);
    let size = st.size;
    let mode = st.mode;
    let ownerId = st.uid;
    let isDir = st.isDirectory();
    let dev = Number(st.dev);
    let ino = Number(st.ino);
    let mtimeMs = Math.round(st.mtimeMs);
    if (isSymlink) {
      try {
        const target = statSync(path); // follows the link
        size = target.size;
        mode = target.mode;
        ownerId = target.uid;
        isDir = target.isDirectory();
        // identity of the *content* lives on the link target
        dev = Number(target.dev);
        ino = Number(target.ino);
        mtimeMs = Math.round(target.mtimeMs);
      } catch {
        return null; // broken symlink
      }
    }
    return {
      name: basename(path),
      path,
      realPath,
      isSymlink,
      size,
      mode,
      ownerId,
      isDir,
      dev,
      ino,
      mtimeMs,
    };
  } catch {
    return null;
  }
}

export function isExecutableFile(info: EntryInfo): boolean {
  return !info.isDir && (info.mode & 0o111) !== 0;
}

export function joinSafe(dir: string, name: string): string {
  return join(dir, name);
}

/** Resolves a symlink chain; returns the input path on failure. */
export function realPathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Reads a symlink target without following it. */
export function readLinkOrNull(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}
