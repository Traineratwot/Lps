import type { CommandKind } from "../../core/types.ts";
import { runCommand } from "../../core/util/exec.ts";
import { stripAnsi } from "../../core/util/text.ts";
import { isDangerousHelpCommand, isElfBinary } from "./safety.ts";

export type HelpSummary = {
  summary: string;
  flag: string;
};

const HELP_TIMEOUT_MS = 2500;
const NOISE_LINE = /^(unrecognized|unknown|invalid|illegal)\s+option/i;

/** First meaningful line: skips option-parse errors and pure usage banners. */
function meaningfulLine(text: string, maxLen = 200): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = stripAnsi(raw).trim();
    if (!line) continue;
    if (NOISE_LINE.test(line)) continue;
    return line.length > maxLen ? line.slice(0, maxLen - 1) + "…" : line;
  }
  return "";
}

/**
 * Collects a one-line summary from `--help` / `-h` / bash `help`.
 * Never runs for aliases (their expansion is the summary).
 */
export function getHelpSummary(
  name: string,
  path: string,
  kind: CommandKind,
): HelpSummary | null {
  if (kind === "alias") return null;
  // never execute dangerous binaries for a mere summary (safety.ts)
  if (isDangerousHelpCommand(name) || isDangerousHelpCommand(path)) return null;
  // scripts ignore arguments and may do real work (--help on a first-boot
  // script = its full body); only native binaries answer flags safely
  if (!isElfBinary(path)) return null;

  if (kind === "builtin") {
    if (!Bun.which("bash")) return null;
    const res = runCommand(["bash", "-c", `help ${name}`], { timeoutMs: HELP_TIMEOUT_MS, dropPrivileges: true });
    const summary = meaningfulLine(res.stdout || res.stderr);
    return summary ? { summary, flag: "help" } : null;
  }

  const bin = path || name;
  for (const flag of ["--help", "-h", "--usage"]) {
    const res = runCommand([bin, flag], { timeoutMs: HELP_TIMEOUT_MS, dropPrivileges: true });
    if (res.timedOut) continue;
    const text = res.stdout || res.stderr;
    const summary = meaningfulLine(text);
    if (summary) return { summary, flag };
  }
  return null;
}
