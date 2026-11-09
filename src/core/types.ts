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
};

export type StageStats = {
  found: number;
  written: number;
  linked: number;
  skipped: number;
  errors: number;
};
