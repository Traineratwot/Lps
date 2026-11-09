/** Strips ANSI escape codes and other control noise from captured output. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x08/g, "");
}

/** First non-empty line, trimmed and cut to maxLen. */
export function firstLine(text: string, maxLen = 200): string {
  for (const line of text.split(/\r?\n/)) {
    const t = stripAnsi(line).trim();
    if (t) return t.length > maxLen ? t.slice(0, maxLen - 1) + "…" : t;
  }
  return "";
}

/** Cleans an Exec= field: drops desktop entry codes (%f, %u, ...) and quotes. */
export function cleanExec(exec: string): string {
  return exec
    .replace(/%%/g, "\u0000")
    .replace(/%[a-zA-Z]/g, "")
    .replace(/\u0000/g, "%")
    .trim();
}

/** First token of an Exec value (handles simple quoting). */
export function execCommandName(exec: string): string {
  const cleaned = cleanExec(exec);
  const match = cleaned.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}
