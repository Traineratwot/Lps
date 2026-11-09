export type FlagValue = string | boolean;

export type ParsedArgs = {
  command: string | null;
  positionals: string[];
  flags: Record<string, FlagValue>;
};

/** Flags that take a value (everything else is boolean). */
const VALUE_FLAGS = new Set(["db", "data-dir", "only", "users", "type", "search", "limit", "format", "out", "interval"]);

/**
 * Minimal argv parser: `lps <command> [positionals] [--flag] [--key value] [--key=value]`.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];
  let command: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const key = body;
      if (VALUE_FLAGS.has(key) && i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
        flags[key] = args[++i]!;
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      // short flags: -h, -V; short value flags like -o out
      const short = arg.slice(1);
      const shortMap: Record<string, string> = { h: "help", V: "version", v: "verbose" };
      const key = shortMap[short] ?? short;
      if (VALUE_FLAGS.has(key) && i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
        flags[key] = args[++i]!;
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (command === null) command = arg;
    else positionals.push(arg);
  }

  return { command, positionals, flags };
}

export function flagString(flags: Record<string, FlagValue>, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

export function flagBool(flags: Record<string, FlagValue>, name: string): boolean {
  return flags[name] === true || flags[name] === "true";
}

export function flagList(flags: Record<string, FlagValue>, name: string): string[] {
  const v = flags[name];
  if (typeof v !== "string") return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
