import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { runCommand } from "../../core/util/exec.ts";

export type ManPage = {
  path: string;
  section: string;
};

const MAN_DIRS = ["/usr/share/man", "/usr/local/share/man", "/var/lib/flatpak/exports/share/man"];
const SECTIONS = ["1", "8", "6", "2", "3", "4", "5", "7"];

/** Finds a man page for a command: prebuilt index first, then `man -w`. */
export function findManPage(name: string): ManPage | null {
  if (!/^[A-Za-z0-9_.:+-]+$/.test(name)) return null;

  const fromIndex = manIndex().get(name);
  if (fromIndex) return fromIndex;

  if (Bun.which("man")) {
    const res = runCommand(["man", "-w", name], { timeoutMs: 3000, env: { MANPAGER: "cat" } });
    if (res.ok) {
      const path = res.stdout.trim().split(/\r?\n/)[0];
      if (path && existsSync(path)) {
        return { path, section: sectionOf(path) };
      }
    }
  }
  return null;
}

let cachedManIndex: Map<string, ManPage> | null = null;

/**
 * Pre-built map of command name → man page from standard man dirs.
 * Built once per scan; `man -w` remains the fallback for custom MANPATH.
 */
export function manIndex(): Map<string, ManPage> {
  if (cachedManIndex) return cachedManIndex;
  const index = new Map<string, ManPage>();
  for (const dir of MAN_DIRS) {
    for (const section of SECTIONS) {
      const manDir = `${dir}/man${section}`;
      if (!existsSync(manDir)) continue;
      let entries: string[];
      try {
        entries = readdirSync(manDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const m = entry.match(/^(.+)\.(\d+)(\.gz|\.xz|\.zst|\.bz2)?$/);
        if (!m) continue;
        const name = m[1]!;
        // first hit wins: MAN_DIRS/SECTIONS order = priority
        if (!index.has(name)) {
          index.set(name, { path: `${manDir}/${entry}`, section: m[2]! });
        }
      }
    }
  }
  cachedManIndex = index;
  return index;
}

export function resetManIndex(): void {
  cachedManIndex = null;
}

function sectionOf(path: string): string {
  const m = path.match(/\.(\d+)(\.gz|\.xz|\.zst|\.bz2)?$/);
  return m ? m[1]! : "";
}

/** Decompresses a man file to troff source text. */
export function readManSource(path: string): string | null {
  try {
    if (!existsSync(path) || statSync(path).size === 0) return null;
    if (path.endsWith(".gz")) {
      return gunzipSync(readFileSync(path)).toString();
    }
    if (path.endsWith(".xz")) return pipeThrough(path, ["xz", "-dc"]);
    if (path.endsWith(".zst")) return pipeThrough(path, ["zstd", "-dc", "--quiet"]);
    if (path.endsWith(".bz2")) return pipeThrough(path, ["bzip2", "-dc"]);
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function pipeThrough(path: string, cmd: string[]): string | null {
  const res = Bun.spawnSync([...cmd, path], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    timeout: 5000,
  });
  if (res.exitCode !== 0) return null;
  return res.stdout?.toString() ?? null;
}

const FONT_RE = /\\f[BIRP]|\f[BIRP]/g;

function cleanTroff(line: string): string {
  return line
    .replace(FONT_RE, "")
    .replace(/\\-|\u2010|\u2011/g, "-")
    .replace(/\\&/g, "")
    .replace(/\\[ |]/g, " ")
    .replace(/\\[a-zA-Z]/g, "")
    .trim();
}

/**
 * Extracts the one-line summary from the NAME section of troff source.
 * Format: `name \- summary text`.
 */
export function summaryFromTroff(source: string): string {
  const lines = source.split(/\r?\n/);
  let inName = false;
  const collected: string[] = [];
  for (const line of lines) {
    if (/^\.SH\s+("NAME"|'NAME'|NAME)\s*$/.test(line)) {
      inName = true;
      continue;
    }
    if (inName) {
      if (/^\.SH\s/.test(line)) break;
      if (line.startsWith(".\\")) continue; // comments
      const cleaned = cleanTroff(line.replace(/^\.B\s+|^\.BI\s+|^\.BR\s+/, ""));
      if (cleaned) collected.push(cleaned);
    }
  }
  const joined = collected.join(" ").replace(/\s+/g, " ").trim();
  // "name - summary" / "name - summary, other - other"
  const dash = joined.indexOf(" - ");
  if (dash >= 0) {
    return joined.slice(dash + 3).split(/,\s+\S+\s+-\s+/)[0]?.trim() ?? "";
  }
  return joined;
}

/** Full pipeline: find man page and extract NAME summary. */
export function getManSummary(name: string): ManPage & { summary: string } | null {
  const page = findManPage(name);
  if (!page) return null;
  const source = readManSource(page.path);
  if (source) {
    const summary = summaryFromTroff(source);
    if (summary) return { ...page, summary };
  }
  // Fallback: rendered text via man(1)
  if (Bun.which("man") && Bun.which("col")) {
    const res = runCommand(["sh", "-c", `MANPAGER=cat MANWIDTH=100 man ${shellQuote(name)} | col -bx`], {
      timeoutMs: 5000,
      env: { MANPAGER: "cat", MANWIDTH: "100" },
    });
    if (res.ok) {
      const rendered = renderedNameSummary(res.stdout);
      if (rendered) return { ...page, summary: rendered };
    }
  }
  return { ...page, summary: "" };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function renderedNameSummary(text: string): string {
  const lines = text.split(/\r?\n/);
  let inName = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "NAME") {
      inName = true;
      continue;
    }
    if (inName) {
      if (!line) continue;
      if (/^[A-Z][A-Z ]+$/.test(line)) break; // next section header
      const dash = line.indexOf(" - ");
      return dash >= 0 ? line.slice(dash + 3).trim() : line;
    }
  }
  return "";
}
