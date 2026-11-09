/** DTO shared by the web server and the React frontend. */

export type PackageRef = {
  id: number;
  type: string;
  name: string;
  version: string;
  section: string;
};

export type CommandChip = {
  id: number;
  name: string;
  kind: string;
  summary: string;
};

export type ProgramCard = {
  id: string; // "de:<desktopId>" | "pkg:<packageId>"
  name: string;
  comment: string;
  iconUrl: string | null;
  pkg: PackageRef | null;
  desktopId: number | null;
  categories: string;
  commands: CommandChip[];
  commandCount: number;
  runningCount: number;
};

export type ProgramDetail = ProgramCard & {
  desktop: {
    id: number;
    filePath: string;
    exec: string;
    genericName: string;
    iconName: string;
    mimeTypes: string;
    terminal: boolean;
    noDisplay: boolean;
    hidden: boolean;
    wmClass: string;
  } | null;
  package: {
    id: number;
    type: string;
    name: string;
    version: string;
    architecture: string;
    maintainer: string;
    description: string;
    section: string;
    origin: string;
    installPath: string;
    meta: Record<string, unknown>;
  } | null;
  commandsFull: {
    id: number;
    name: string;
    kind: string;
    path: string;
    realPath: string;
    aliasOf: string;
    source: string;
    summary: string;
    manPath: string;
    manSection: string;
  }[];
  processes: ProcessRow[];
};

export type CommandRow = {
  id: number;
  name: string;
  kind: string;
  path: string;
  realPath: string;
  summary: string;
  packageName: string | null;
  processCount: number;
};

export type CommandDetail = CommandRow & {
  aliasOf: string;
  source: string;
  doc: {
    summary: string;
    manPath: string;
    manSection: string;
    source: string;
    helpFlag: string;
  } | null;
  package: PackageRef | null;
  desktopEntries: { id: number; name: string; filePath: string }[];
  processes: ProcessRow[];
};

export type ProcessRow = {
  id: number;
  pid: number;
  user: string;
  cmdline: string;
  exePath: string;
  isKernel: boolean;
  startedAt: string;
  packageName: string | null;
  commandName: string | null;
  state: string;
  cpuPercent: number | null;
  rssKb: number | null;
  uptimeSec: number | null;
};

export type ProcessDetail = ProcessRow & {
  ppid: number | null;
  uid: number | null;
  snapshots: {
    id: number;
    observedAt: string;
    uptimeSec: number;
    cpuPercent: number | null;
    rssKb: number | null;
    state: string;
    threads: number | null;
  }[];
};

export type DesktopRow = {
  id: number;
  name: string;
  comment: string;
  exec: string;
  iconName: string;
  iconUrl: string | null;
  categories: string;
  terminal: boolean;
  noDisplay: boolean;
  hidden: boolean;
  filePath: string;
  packageName: string | null;
  commandName: string | null;
};

export type ListResp<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type DocText = {
  kind: "man" | "help";
  source: string;
  text: string;
  truncated: boolean;
};

export type StatsResp = {
  commands: number;
  packages: number;
  desktopEntries: number;
  processes: number;
  packagesByType: Record<string, number>;
  commandsByKind: Record<string, number>;
  lastScan: string | null;
};
