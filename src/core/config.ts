import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { listUsers } from "./util/users.ts";

export type LpsConfig = {
  /** Path to the SQLite database file. */
  dbPath: string;
  /** Directory for extracted icons and other artifacts. */
  dataDir: string;
  /** Users whose shell rc files are scanned for aliases. */
  users: string[];
  /** Skip man/--help collection. */
  skipDocs: boolean;
  /** Skip icon extraction. */
  noIcons: boolean;
};

const SYSTEM_DATA_DIR = "/var/lib/lps";

function defaultDataDir(): string {
  // /var/lib/lps is the canonical location once installed (created by
  // `bun run build:install`); fall back to a user dir for uninstalled runs.
  if (existsSync(SYSTEM_DATA_DIR)) return SYSTEM_DATA_DIR;
  return join(process.env.HOME ?? "/tmp", ".local", "share", "lps");
}

export type ConfigOverrides = Partial<
  Pick<LpsConfig, "dbPath" | "dataDir" | "users" | "skipDocs" | "noIcons">
>;

export function resolveConfig(overrides: ConfigOverrides = {}): LpsConfig {
  const dataDir = resolve(overrides.dataDir ?? process.env.LPS_DATA_DIR ?? defaultDataDir());
  // Canonical DB path for everyone (root scan + user queries hit the same
  // file); override with --db / LPS_DB for experiments.
  const dbRaw = overrides.dbPath ?? process.env.LPS_DB ?? join(dataDir, "lps.db");
  const dbPath = isAbsolute(dbRaw) ? dbRaw : resolve(dbRaw);

  let users = overrides.users ?? [];
  if (users.length === 0) {
    // all login users — aliases and per-user files of the whole system
    users = listUsers().map((u) => u.name);
    if (users.length === 0) users = ["root"];
  }

  return {
    dbPath,
    dataDir,
    users,
    skipDocs: overrides.skipDocs ?? false,
    noIcons: overrides.noIcons ?? false,
  };
}

export function iconsDir(config: LpsConfig): string {
  return join(config.dataDir, "icons");
}
