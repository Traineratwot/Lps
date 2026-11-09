#!/usr/bin/env bun
import { flagBool, flagList, flagString, parseArgs } from "./cli/args.ts";
import { printCommandHelp, printGlobalHelp, printVersion } from "./cli/help.ts";
import { runDoctor, runInit } from "./cli/commands/system.ts";
import { runScan } from "./cli/commands/scan.ts";
import { runExport, runList, runLogs, runShow } from "./cli/commands/query.ts";
import { runWeb } from "./cli/commands/web.ts";
import { red, yellow } from "./cli/ui/style.ts";
import { resolveConfig } from "./core/config.ts";

const COMMANDS = new Set(["init", "scan", "list", "show", "logs", "export", "doctor", "db", "web"]);

/** scan/doctor/init mutate system state and expect root. */
const NEEDS_ROOT = new Set(["scan"]);

async function main(): Promise<void> {
  const { command, positionals, flags } = parseArgs(process.argv);

  if (flagBool(flags, "version") || command === "--version") {
    printVersion();
    return;
  }
  if (command === null || command === "help" || flagBool(flags, "help")) {
    if (command && command !== "help") printCommandHelp(command);
    else printGlobalHelp();
    return;
  }
  if (!COMMANDS.has(command)) {
    console.error(red(`Unknown command: ${command}`));
    console.error(`Run ${yellow("lps --help")} to see available commands.`);
    process.exitCode = 1;
    return;
  }

  const config = resolveConfig({
    dbPath: flagString(flags, "db"),
    dataDir: flagString(flags, "data-dir"),
    users: flagList(flags, "users"),
    skipDocs: flagBool(flags, "skip-docs"),
    noIcons: flagBool(flags, "no-icons"),
  });

  if (NEEDS_ROOT.has(command) && typeof process.getuid === "function" && process.getuid() !== 0) {
    console.error(red(`lps ${command} must run as root: `) + yellow(`sudo lps ${command}`));
    process.exitCode = 1;
    return;
  }

  switch (command) {
    case "init":
      await runInit(config);
      break;
    case "doctor":
      await runDoctor(config);
      break;
    case "scan":
      await runScan(config, { only: flagList(flags, "only") });
      break;
    case "list":
      await runList(config, positionals[0], flags);
      break;
    case "show":
      await runShow(config, positionals[0], flags);
      break;
    case "logs":
      await runLogs(config, positionals[0], flags);
      break;
    case "export":
      await runExport(config, flags);
      break;
    case "web":
      await runWeb(config, flags);
      break;
    case "db": {
      const sub = positionals[0];
      if (sub === "path" || sub === undefined) {
        console.log(config.dbPath);
      } else {
        console.error(red(`Unknown db subcommand: ${sub}`));
        process.exitCode = 1;
      }
      break;
    }
  }
}

main().catch((error) => {
  console.error(red(String(error instanceof Error ? error.stack ?? error.message : error)));
  process.exitCode = 1;
});
