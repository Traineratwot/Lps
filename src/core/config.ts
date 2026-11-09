import { homedir, userInfo } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

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

const DEFAULT_DATA_DIR = "/var/lib/lps";

function defaultDataDir(): string {
  try {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return DEFAULT_DATA_DIR;
    }
  } catch {
    // fall through
  }
  return join(homedir(), ".local", "share", "lps");
}

export type ConfigOverrides = Partial<
  Pick<LpsConfig, "dbPath" | "dataDir" | "users" | "skipDocs" | "noIcons">
>;

export function resolveConfig(overrides: ConfigOverrides = {}): LpsConfig {
  const dataDir = resolve(overrides.dataDir ?? process.env.LPS_DATA_DIR ?? defaultDataDir());
  const dbRaw = overrides.dbPath ?? process.env.LPS_DB ?? join(dataDir, "lps.db");
  const dbPath = isAbsolute(dbRaw) ? dbRaw : resolve(dbRaw);

  let users = overrides.users ?? [];
  if (users.length === 0) {
    try {
      users = [userInfo().username];
    } catch {
      users = ["root"];
    }
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
