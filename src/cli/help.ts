import { bold, dim, cyan } from "./ui/style.ts";

const VERSION = "0.1.1";

const COMMANDS: Array<{ name: string; args: string; desc: string }> = [
  { name: "init", args: "", desc: "Create or upgrade the database schema (idempotent)" },
  { name: "scan", args: "[--only <stages>]", desc: "Scan the system and fill the database" },
  { name: "list", args: "<commands|packages|services|desktop|processes>", desc: "List indexed entities" },
  { name: "show", args: "<name|pkg|pid>", desc: "Show a full card for a command/package/process" },
  { name: "logs", args: "<pid|name>", desc: "Show process snapshot history" },
  { name: "export", args: "[--format json|csv]", desc: "Export index to stdout or a file" },
  { name: "web", args: "[--port <n>] [--host <addr>]", desc: "Browse the index in a local web UI (read-only)" },
  { name: "doctor", args: "", desc: "Check environment (root, db, required tools)" },
  { name: "db", args: "path", desc: "Show database file path" },
];

const SCAN_STAGES = "commands, docs, packages, services, desktop, processes";

export function printGlobalHelp(): void {
  const lines: string[] = [];
  lines.push(`${bold("lps")} ${dim(`v${VERSION}`)} — index of installed and running programs (Debian/Ubuntu)`);
  lines.push("");
  lines.push(`${bold("USAGE")}`);
  lines.push(`  lps <command> [options]`);
  lines.push("");
  lines.push(`${bold("COMMANDS")}`);
  for (const c of COMMANDS) {
    lines.push(`  ${cyan(c.name.padEnd(10))} ${c.args.padEnd(38)} ${c.desc}`);
  }
  lines.push("");
  lines.push(`${bold("GLOBAL OPTIONS")}`);
  lines.push(`  --db <path>          Database file (default: /var/lib/lps/lps.db)`);
  lines.push(`  --data-dir <path>    Data directory for icons (default: /var/lib/lps)`);
  lines.push(`  --users <a,b>        Users whose shell rc files are scanned for aliases`);
  lines.push(`  -h, --help           Show this help`);
  lines.push(`  -V, --version        Show version`);
  lines.push("");
  lines.push(dim("  scan needs sudo; list/show/logs/export work without it (read-only)."));
  lines.push("");
  lines.push(`${bold("EXAMPLES")}`);
  lines.push(`  bun run build:install            build and install to /usr/local/bin/lps`);
  lines.push(`  sudo lps scan                    fill the index (root required)`);
  lines.push(`  sudo lps scan --only commands,packages`);
  lines.push(`  lps list packages --type deb --search git    (works without sudo)`);
  lines.push(`  lps show git`);
  lines.push(`  lps logs 1234`);
  lines.push("");
  lines.push(`Run ${dim("lps <command> --help")} for command-specific options.`);
  console.log(lines.join("\n"));
}

export function printCommandHelp(command: string): void {
  const entry = COMMANDS.find((c) => c.name === command);
  if (!entry) {
    console.error(`Unknown command: ${command}`);
    printGlobalHelp();
    return;
  }
  const lines: string[] = [];
  lines.push(`${bold("lps " + command)} ${dim(entry.args)} — ${entry.desc}`);
  lines.push("");
  switch (command) {
    case "scan":
      lines.push(`  --only <stages>   Comma-separated stages to run: ${dim(SCAN_STAGES)}`);
      lines.push(`  --skip-docs       Skip man/--help collection`);
      lines.push(`  --no-icons        Skip icon extraction`);
      lines.push(`  --users <a,b>     Users for alias scanning`);
      break;
    case "list":
      lines.push(`  lps list commands|packages|services|desktop|processes`);
      lines.push(`  --type <t>        Filter packages: deb|flatpak|appimage`);
      lines.push(`  --search <q>      Substring filter on name`);
      lines.push(`  --limit <n>       Max rows (default 50)`);
      lines.push(`  --orphan          Only entities with no links`);
      break;
    case "show":
      lines.push(`  lps show <name>        command card`);
      lines.push(`  lps show pkg:<name>    package card
      lps show svc:<name>    systemd service card`);
      lines.push(`  lps show <pid>         process card`);
      break;
    case "logs":
      lines.push(`  lps logs <pid|name>    snapshot history (observedAt, uptime, cpu, rss)`);
      break;
    case "export":
      lines.push(`  --format json|csv  Output format (default json)`);
      lines.push(`  --out <file>       Write to file instead of stdout`);
      break;
    case "web":
      lines.push(`  --port <n>         Port to listen on (default 8787)`);
      lines.push(`  --host <addr>      Address to bind (default 127.0.0.1)`);
      lines.push(`  --open             Open the UI in the default browser`);
      lines.push(dim("  View-only UI: programs as cards, search and filters."));
      break;
    default:
      lines.push(`  No additional options.`);
  }
  console.log(lines.join("\n"));
}

export function printVersion(): void {
  console.log(`lps ${VERSION}`);
}
