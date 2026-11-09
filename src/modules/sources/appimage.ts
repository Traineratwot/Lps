import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RawPackage } from "../distro/types.ts";
import { runCommand } from "../../core/util/exec.ts";
import { userHomeDirs } from "../../core/util/users.ts";
import { parseDesktopFile, type DesktopFile } from "../desktop/xdg.ts";

const MIN_SIZE = 1024 * 1024; // 1 MB
const EXTRACT_TIMEOUT_MS = 20000;

function searchRoots(): string[] {
  const roots = new Set<string>([
    "/opt", "/opt/appimages", "/opt/AppImage",
    "/usr/local/bin", "/usr/local/AppImage", "/Applications",
  ]);
  for (const home of userHomeDirs()) {
    for (const sub of ["Applications", "Downloads", "Desktop", "appimages"]) {
      roots.add(join(home, sub));
    }
  }
  return [...roots];
}

/** Finds *.AppImage files (shallow walk, 2 levels). */
export function findAppImageFiles(): string[] {
  const found: string[] = [];
  for (const root of searchRoots()) {
    if (!existsSync(root)) continue;
    for (const name of safeList(root)) {
      const path = join(root, name);
      const st = safeStat(path);
      if (st?.isFile() && isAppImage(name) && st.size >= MIN_SIZE) {
        found.push(path);
        continue;
      }
      if (st?.isDirectory()) {
        for (const inner of safeList(path)) {
          const innerPath = join(path, inner);
          const innerSt = safeStat(innerPath);
          if (innerSt?.isFile() && isAppImage(inner) && innerSt.size >= MIN_SIZE) {
            found.push(innerPath);
          }
        }
      }
    }
  }
  return found;
}

function isAppImage(name: string): boolean {
  return /\.appimage$/i.test(name) && !name.toLowerCase().endsWith(".zsync");
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

export type AppImageMeta = {
  desktop: DesktopFile | null;
  version: string;
};

/**
 * Extracts embedded metadata via `--appimage-extract` (works without FUSE).
 * Returns null when extraction fails — caller falls back to filename heuristics.
 */
export function extractAppImageMeta(path: string): AppImageMeta | null {
  const workDir = mkdtempSync(join(tmpdir(), "lps-appimage-"));
  try {
    runCommand([path, "--appimage-extract"], {
      timeoutMs: EXTRACT_TIMEOUT_MS,
      cwd: workDir,
    });
    const squashRoot = join(workDir, "squashfs-root");
    if (!existsSync(squashRoot)) return null;

    let desktop: DesktopFile | null = null;
    for (const name of safeList(squashRoot)) {
      if (!name.endsWith(".desktop") || name.startsWith(".")) continue;
      try {
        desktop = parseDesktopFile(readFileSync(join(squashRoot, name), "utf8"));
        if (desktop) break;
      } catch {
        // try next
      }
    }
    return { desktop, version: desktop?.extra["X-AppImage-Version"] ?? "" };
  } catch {
    return null;
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // leftover temp dir is acceptable
    }
  }
}

/** All AppImages as packages (plus their embedded desktop metadata). Memoized per process. */
let cachedPackages: RawPackage[] | null = null;

export async function listAppImagePackages(): Promise<RawPackage[]> {
  if (cachedPackages) return cachedPackages;
  const result: RawPackage[] = [];
  for (const path of findAppImageFiles()) {
    const meta = extractAppImageMeta(path);
    const desktop = meta?.desktop;
    const name = desktop?.name || path.split("/").pop()!.replace(/\.appimage$/i, "");
    result.push({
      type: "appimage",
      name,
      version: meta?.version || "",
      architecture: "",
      status: "installed",
      maintainer: "",
      description: desktop?.comment ?? "",
      section: desktop?.categories ?? "",
      origin: path.substring(0, path.lastIndexOf("/")),
      installPath: path,
      meta: {
        exec: desktop?.exec ?? "",
        icon: desktop?.icon ?? "",
        desktopName: desktop?.name ?? "",
      },
    });
  }
  cachedPackages = result;
  return result;
}

export function resetAppImageCache(): void {
  cachedPackages = null;
}
