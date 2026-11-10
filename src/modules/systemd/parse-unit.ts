export type ParsedUnit = {
  description: string;
  /** Raw ExecStart= line (first one, prefixes kept). */
  execStart: string;
  /** Absolute path of the first ExecStart executable, "" when not absolute. */
  execStartPath: string;
  user: string;
  /** [Install] WantedBy= entries, comma-joined. */
  wantedBy: string;
};

/** Strips systemd exec prefixes: `-@+:!` and friends. */
function stripExecPrefix(token: string): string {
  return token.replace(/^[-@+:!$]+/, "");
}

/**
 * Parses a systemd unit file body ([Unit]/[Service]/[Install]).
 * Handles backslash line continuations; ignores comments.
 */
export function parseUnitFile(content: string): ParsedUnit {
  const out: ParsedUnit = {
    description: "",
    execStart: "",
    execStartPath: "",
    user: "",
    wantedBy: "",
  };

  // join continuation lines: "ExecStart=foo \\\n  --bar" (collapse the gap)
  const logical = content.replace(/[ \t]*\\\r?\n[ \t]*/g, " ");

  let section = "";
  for (const rawLine of logical.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1]!.toLowerCase();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (key === "Description" && !out.description) {
      out.description = value;
    } else if (key === "ExecStart" && !out.execStart && section !== "install") {
      out.execStart = value;
      const first = stripExecPrefix(value.split(/\s+/)[0] ?? "").replace(/^["']|["']$/g, "");
      if (first.startsWith("/")) out.execStartPath = first;
    } else if (key === "User" && section === "service") {
      out.user = value;
    } else if (key === "WantedBy" && section === "install") {
      out.wantedBy = value
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",");
    }
  }
  return out;
}

/** Extracts the executable path from `systemctl show` ExecStart= block. */
export function execPathFromShow(execStartBlock: string): string {
  const m = execStartBlock.match(/\bpath=([^;\s]+)/);
  return m ? (m[1] ?? "") : "";
}
