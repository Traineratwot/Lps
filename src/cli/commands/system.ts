import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { bold, cyan, dim, green, red, yellow } from "../ui/style.ts";
import type { LpsConfig } from "../../core/config.ts";
import { iconsDir } from "../../core/config.ts";
import { ensureSchema } from "../../core/db.ts";

export async function runInit(config: LpsConfig): Promise<void> {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  mkdirSync(iconsDir(config), { recursive: true });

  await ensureSchema(config.dbPath);

  console.log(`${green("✓")} schema applied to ${cyan(config.dbPath)}`);
  console.log(`${green("✓")} data dir ${cyan(config.dataDir)}`);
}

export async function runDoctor(config: LpsConfig): Promise<void> {
  const rows: Array<[string, string, "ok" | "warn" | "bad"]> = [];

  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  rows.push([
    "root",
    isRoot ? "yes" : "no (only `scan` needs sudo; queries work without it)",
    isRoot ? "ok" : "warn",
  ]);

  const onPath = Bun.which("lps");
  rows.push([
    "lps on PATH",
    onPath ?? "not installed — run: bun run build:install",
    onPath ? "ok" : "warn",
  ]);

  const dbExists = existsSync(config.dbPath);
  let dbWritable = false;
  try {
    accessSync(config.dbPath, constants.W_OK);
    dbWritable = true;
  } catch {
    dbWritable = false;
  }
  rows.push([
    "database",
    dbExists
      ? `${config.dbPath} (${dbWritable ? "read-write" : "read-only for you"})`
      : `${config.dbPath} (missing — run: sudo lps scan)`,
    dbExists ? "ok" : "warn",
  ]);

  const tools: Array<[string, string]> = [
    ["dpkg", "dpkg"],
    ["flatpak", "flatpak"],
    ["man", "man"],
    ["update-alternatives", "update-alternatives"],
  ];
  for (const [label, bin] of tools) {
    const found = Bun.which(bin);
    rows.push([label, found ?? "not found", found ? "ok" : "warn"]);
  }

  rows.push(["bun", Bun.version, "ok"]);
  rows.push(["platform", `${process.platform} ${process.arch}`, "ok"]);

  for (const [name, value, status] of rows) {
    const mark = status === "ok" ? green("✓") : status === "warn" ? yellow("!") : red("✗");
    console.log(`${mark} ${bold(name.padEnd(16))} ${dim(value)}`);
  }
}
