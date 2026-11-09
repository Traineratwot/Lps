import type { LpsConfig } from "../../core/config.ts";
import { DbOpenError, openDb } from "../../core/db.ts";
import { createWebServer } from "../../web/server/server.ts";
import type { FlagValue } from "../args.ts";
import { flagBool, flagString } from "../args.ts";
import { bold, cyan, dim, red } from "../ui/style.ts";

export async function runWeb(config: LpsConfig, flags: Record<string, FlagValue>): Promise<void> {
  const port = Number.parseInt(flagString(flags, "port") ?? "8787", 10);
  const host = flagString(flags, "host") ?? "127.0.0.1";

  let db;
  try {
    db = await openDb(config);
  } catch (error) {
    if (error instanceof DbOpenError) {
      console.error(red(error.message));
      console.error(`Run ${bold("sudo lps scan")} first, or pass ${bold("--db <path>")}.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // The UI never writes; the server may hold a read-only handle on a root-owned DB.
  const server = await createWebServer(config, { db, port, host, readonly: true });

  console.log(`${bold("LPS web UI")} → ${cyan(server.url)}  ${dim(`(db: ${config.dbPath}, read-only)`)}`);
  console.log(dim("Press Ctrl+C to stop."));

  if (flagBool(flags, "open")) {
    const opener = Bun.which("xdg-open");
    if (opener) {
      Bun.spawn([opener, server.url], { stdout: "ignore", stderr: "ignore" });
    }
  }

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      server.stop();
      console.log(dim("\nstopped."));
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
