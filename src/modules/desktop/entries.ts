import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { userHomeDirs } from "../../core/util/users.ts";
import { parseDesktopFile, type DesktopFile } from "./xdg.ts";

export type RawDesktopEntry = {
  filePath: string;
  name: string;
  genericName: string;
  comment: string;
  exec: string;
  tryExec: string;
  iconName: string;
  categories: string;
  mimeTypes: string;
  terminal: boolean;
  noDisplay: boolean;
  hidden: boolean;
  wmClass: string;
  meta: Record<string, unknown>;
};

const SYSTEM_DIRS = [
  "/usr/share/applications",
  "/usr/local/share/applications",
  "/var/lib/flatpak/exports/share/applications",
  "/var/lib/snapd/desktop/applications",
];

/** All XDG application dirs, including per-user ones. */
export function desktopDirs(): string[] {
  const dirs = [...SYSTEM_DIRS];
  for (const home of userHomeDirs()) {
    dirs.push(join(home, ".local/share/applications"));
  }
  return dirs.filter((dir) => existsSync(dir));
}

function walkDesktopFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 3) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkDesktopFiles(path, out, depth + 1);
    else if (entry.endsWith(".desktop")) out.push(path);
  }
}

function toRaw(filePath: string, parsed: DesktopFile): RawDesktopEntry {
  return {
    filePath,
    name: parsed.name,
    genericName: parsed.genericName,
    comment: parsed.comment,
    exec: parsed.exec,
    tryExec: parsed.tryExec,
    iconName: parsed.icon,
    categories: parsed.categories,
    mimeTypes: parsed.mimeTypes,
    terminal: parsed.terminal,
    noDisplay: parsed.noDisplay,
    hidden: parsed.hidden,
    wmClass: parsed.wmClass,
    meta: {
      type: parsed.type,
      locales: parsed.locales,
      extra: parsed.extra,
    },
  };
}

/** Parses every .desktop file in the XDG application dirs. */
export function scanDesktopEntries(): RawDesktopEntry[] {
  const files: string[] = [];
  for (const dir of desktopDirs()) walkDesktopFiles(dir, files);

  const result: RawDesktopEntry[] = [];
  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseDesktopFile(content);
    if (!parsed) continue;
    // only Application launchers
    if (parsed.type && parsed.type !== "Application") continue;
    result.push(toRaw(filePath, parsed));
  }
  return result;
}
