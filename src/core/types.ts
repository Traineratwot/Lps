/** Shared raw scan types — plain data, no DB/Prisma types here. */

export type CommandKind = "exec" | "alias" | "builtin" | "alternative";

export type RawCommand = {
  name: string;
  kind: CommandKind;
  /** Filesystem path; "" for builtin/alias. */
  path: string;
  /** Resolved symlink target; "" when not applicable. */
  realPath: string;
  /** Alias expansion; "" when not an alias. */
  aliasOf: string;
  /** Origin: path | alias | builtin | alternatives | flatpak-export | snap */
  source: string;
  isSymlink: boolean;
  size: number | null;
  mode: number | null;
  ownerId: number | null;
  /** File identity on disk (dev/ino of the content), null for alias/builtin. */
  dev: number | null;
  ino: number | null;
  mtimeMs: number | null;
};

export type StageStats = {
  found: number;
  written: number;
  linked: number;
  skipped: number;
  errors: number;
};

export type RawService = {
  /** Unit name, e.g. "ssh.service". */
  name: string;
  description: string;
  /** Absolute path of the unit file; "" when only known from systemd runtime. */
  unitPath: string;
  activeState: string;
  subState: string;
  /** enabled | disabled | static | masked | "" when unknown. */
  enabledState: string;
  /** Raw ExecStart= line. */
  execStart: string;
  /** Absolute path of the ExecStart executable, "" when unknown. */
  execStartPath: string;
  user: string;
  wantedBy: string;
  mainPid: number | null;
};
