import { existsSync } from "node:fs";
import { runCommand } from "../../../core/util/exec.ts";
import { readManSource, summaryFromTroff } from "../../../modules/docs/man.ts";
import { isDangerousHelpCommand, isElfBinary } from "../../../modules/docs/safety.ts";
import { stripAnsi } from "../../../core/util/text.ts";

export type DocText = {
  kind: "man" | "help";
  /** Where the text came from ("man -l", "--help", "alias"...). */
  source: string;
  text: string;
  truncated: boolean;
};

const MAX_CHARS = 200_000;

function clip(text: string): { text: string; truncated: boolean } {
  const clean = stripAnsi(text).replace(/\n{4,}/g, "\n\n\n");
  return clean.length > MAX_CHARS
    ? { text: clean.slice(0, MAX_CHARS) + "\n… [обрезано]", truncated: true }
    : { text: clean, truncated: false };
}

/**
 * Renders a man page to plain text. Uses the system `man` renderer when
 * available (groff output piped through col), falls back to raw troff source.
 */
export function renderManPage(name: string, manPath: string): DocText | null {
  if (!manPath && !name) return null;

  if (manPath && existsSync(manPath) && Bun.which("man") && Bun.which("col")) {
    const res = runCommand(["sh", "-c", `MANPAGER=cat MANWIDTH=100 man -l ${shellQuote(manPath)} | col -bx`], {
      timeoutMs: 8000,
      env: { MANPAGER: "cat", MANWIDTH: "100" },
    });
    if (res.ok && res.stdout.trim()) {
      return { kind: "man", source: "man -l", ...clip(res.stdout) };
    }
  }

  if (manPath && existsSync(manPath)) {
    const source = readManSource(manPath);
    if (source) {
      const summary = summaryFromTroff(source);
      const body = summary ? `NAME\n    ${name} - ${summary}\n\n${source}` : source;
      return { kind: "man", source: "troff", ...clip(body) };
    }
  }
  return null;
}

/**
 * Captures `--help` / bash `help` output for a command. Aliases report
 * their expansion instead of executing anything.
 */
export function renderHelpPage(name: string, path: string, kind: string, aliasOf: string): DocText | null {
  if (kind === "alias") {
    return { kind: "help", source: "alias", text: aliasOf || "(пусто)", truncated: false };
  }
  // never execute dangerous binaries — see modules/docs/safety.ts
  if (isDangerousHelpCommand(name) || isDangerousHelpCommand(path)) {
    return {
      kind: "help",
      source: "skipped",
      text: "Вывод справки не запрашивается: команда входит в список опасных для запуска (см. modules/docs/safety.ts).",
      truncated: false,
    };
  }
  // scripts ignore arguments and run their full body — never execute
  if (path && existsSync(path) && !isElfBinary(path)) {
    return {
      kind: "help",
      source: "skipped",
      text: "Вывод справки не запрашивается: это скрипт, а не ELF-бинарь (скрипты могут игнорировать аргументы и выполнять свои действия).",
      truncated: false,
    };
  }

  if (kind === "builtin") {
    if (!Bun.which("bash")) return null;
    const res = runCommand(["bash", "-c", `help ${name}`], { timeoutMs: 3000, dropPrivileges: true });
    const text = res.stdout || res.stderr;
    return text.trim() ? { kind: "help", source: "help", ...clip(text) } : null;
  }

  const bin = path || name;
  for (const flag of ["--help", "-h", "--usage"]) {
    const res = runCommand([bin, flag], { timeoutMs: 3000, dropPrivileges: true });
    // code === null means the binary could not be spawned at all
    if (res.timedOut || res.code === null) continue;
    const text = res.stdout || res.stderr;
    if (text.trim()) {
      return { kind: "help", source: flag, ...clip(text) };
    }
  }
  return null;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
