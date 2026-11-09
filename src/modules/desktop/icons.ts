import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ICON_DIRS = [
  "/usr/share/icons",
  "/usr/local/share/icons",
  "/usr/share/pixmaps",
  "/usr/local/share/pixmaps",
  "/var/lib/flatpak/exports/share/icons",
];

const SIZE_RANK: Record<string, number> = {
  scalable: 100,
  "256x256": 90,
  "512x512": 88,
  "128x128": 80,
  "96x96": 70,
  "64x64": 60,
  "48x48": 50,
  "32x32": 40,
  "24x24": 30,
  "22x22": 25,
  "16x16": 20,
};
const EXT_RANK: Record<string, number> = { svg: 3, png: 2, xpm: 1 };
const THEME_RANK: Record<string, number> = {
  hicolor: 5,
  Yaru: 10,
  Adwaita: 9,
  breeze: 8,
  Papirus: 7,
};

type IconEntry = { path: string; score: number };

let cachedIndex: Map<string, IconEntry> | null = null;

function sizeFromPath(path: string): string {
  const m = path.match(/\/(scalable|symbolic|\d+x\d+(?:@\d+x?)?)\//);
  return m ? m[1]! : "";
}

function scoreOf(theme: string, size: string, ext: string): number {
  return (SIZE_RANK[size] ?? (size === "symbolic" ? 65 : 10)) + (EXT_RANK[ext] ?? 0) * 1000 + (THEME_RANK[theme] ?? 0);
}

/**
 * Prebuilt map: icon name → best matching file on disk.
 * Theme layouts differ (size/category vs category/size vs symbolic/) —
 * walk each theme tree recursively and score candidates.
 */
export function iconIndex(): Map<string, IconEntry> {
  if (cachedIndex) return cachedIndex;
  const index = new Map<string, IconEntry>();

  const consider = (name: string, path: string, score: number): void => {
    const current = index.get(name);
    if (!current || score > current.score) index.set(name, { path, score });
  };

  for (const root of ICON_DIRS) {
    if (!existsSync(root)) continue;
    if (root.endsWith("pixmaps")) {
      for (const file of safeList(root)) {
        const m = file.match(/^(.+)\.(png|svg|xpm)$/);
        if (m) consider(m[1]!, join(root, file), scoreOf("pixmaps", "48x48", m[2]!));
      }
      continue;
    }
    for (const theme of safeList(root)) {
      const themeDir = join(root, theme);
      if (!safeStat(themeDir)?.isDirectory()) continue;
      walkTheme(themeDir, theme, (name, path, ext) => {
        consider(name, path, scoreOf(theme, sizeFromPath(path), ext));
      });
    }
  }
  cachedIndex = index;
  return index;
}

function walkTheme(
  dir: string,
  theme: string,
  onIcon: (name: string, path: string, ext: string) => void,
  depth = 0,
): void {
  if (depth > 4) return;
  for (const entry of safeList(dir)) {
    const path = join(dir, entry);
    const st = safeStat(path);
    if (!st) continue;
    if (st.isDirectory()) {
      walkTheme(path, theme, onIcon, depth + 1);
      continue;
    }
    const m = entry.match(/^(.+)\.(png|svg|xpm)$/);
    if (m) onIcon(m[1]!, path, m[2]!);
  }
}

export function resetIconIndex(): void {
  cachedIndex = null;
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

export type ResolvedIcon = {
  /** Original Icon= value. */
  raw: string;
  /** Absolute path of the found icon file, "" when not found. */
  sourcePath: string;
};

/** Resolves an Icon= key to a file on disk (absolute path, name, or theme lookup). */
export function resolveIcon(raw: string): ResolvedIcon {
  const value = raw.trim();
  if (!value) return { raw: "", sourcePath: "" };

  if (value.startsWith("/")) {
    return existsSync(value) ? { raw: value, sourcePath: value } : { raw: value, sourcePath: "" };
  }

  const name = value.replace(/\.(png|svg|xpm)$/i, "");
  const withExt = iconIndex().get(name);
  if (withExt) return { raw: value, sourcePath: withExt.path };

  // filename with extension dropped from the index key
  const direct = iconIndex().get(value);
  if (direct) return { raw: value, sourcePath: direct.path };

  return { raw: value, sourcePath: "" };
}

/**
 * Copies an icon into the data dir, deduplicated by content hash.
 * Returns the stored path or "" on failure.
 */
export function extractIcon(sourcePath: string, iconsDir: string): string {
  if (!sourcePath || !existsSync(sourcePath)) return "";
  try {
    mkdirSync(iconsDir, { recursive: true });
    const data = readFileSync(sourcePath);
    const digest = createHash("sha256").update(data).digest("hex");
    const ext = sourcePath.split(".").pop()?.toLowerCase() ?? "png";
    const target = join(iconsDir, `${digest.slice(0, 32)}.${ext}`);
    if (!existsSync(target)) copyFileSync(sourcePath, target);
    return target;
  } catch {
    return "";
  }
}
