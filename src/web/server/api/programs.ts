import { resolve, sep } from "node:path";
import type { Db } from "../../../core/db.ts";
import type {
  CommandChip,
  ListResp,
  ProcessRow,
  ProgramCard,
  ProgramDetail,
} from "../../types.ts";

// ---------------------------------------------------------------------------
// Pure merge (unit-tested without a database)
// ---------------------------------------------------------------------------

export type MergeDesktop = {
  id: number;
  name: string;
  comment: string;
  categories: string;
  /** Pre-validated icon URL (null when no icon or path escapes the icons dir). */
  iconUrl: string | null;
  packageId: number | null;
  pkg: { id: number; type: string; name: string; version: string; section: string } | null;
  ownCommand: CommandChip | null;
};

/** True when `path` lies inside `root` (both resolved). */
export function isInsideDir(path: string, root: string): boolean {
  const full = resolve(path);
  const base = resolve(root);
  return full === base || full.startsWith(base + sep);
}

/**
 * Icon URL for a desktop entry, or null when the icon is missing or its
 * stored path escapes the icons directory (must never be served).
 */
export function safeIconUrl(iconPath: string, iconsRoot: string, desktopId: number): string | null {
  if (!iconPath) return null;
  return isInsideDir(iconPath, iconsRoot) ? `/api/icons/${desktopId}` : null;
}

export type MergePackage = {
  id: number;
  type: string;
  name: string;
  version: string;
  section: string;
  description: string;
};

export type MergeAgg = {
  commandsByPackage: Map<number, CommandChip[]>;
  commandCountByPackage: Map<number, number>;
  runningByPackage: Map<number, number>;
  runningByCommand: Map<number, number>;
};

export type ProgramFilter = {
  q?: string;
  type?: string;
  section?: string;
  category?: string;
  hasIcon?: boolean;
  running?: boolean;
  sort?: string;
  page: number;
  pageSize: number;
};

const COMMANDS_ON_CARD = 6;

/**
 * One card per desktop entry (launchable app) + synthesized cards for
 * packages with no desktop entries.
 */
export function mergeProgramCards(
  desktops: MergeDesktop[],
  orphanPackages: MergePackage[],
  agg: MergeAgg,
): ProgramCard[] {
  const cards: ProgramCard[] = [];

  for (const d of desktops) {
    const pkgId = d.pkg?.id ?? d.packageId ?? null;
    const cmds = new Map<number, CommandChip>();
    if (d.ownCommand) cmds.set(d.ownCommand.id, d.ownCommand);
    const pkgCmds = pkgId != null ? agg.commandsByPackage.get(pkgId) ?? [] : [];
    for (const c of pkgCmds) cmds.set(c.id, c);
    const ownInPackage = d.ownCommand ? pkgCmds.some((x) => x.id === d.ownCommand!.id) : true;
    const commandCount =
      (pkgId != null ? agg.commandCountByPackage.get(pkgId) ?? 0 : 0) + (d.ownCommand && !ownInPackage ? 1 : 0);
    // processes linked to the package are counted once; the desktop's own
    // command adds only processes that are not already linked to the package
    const runningCount =
      (pkgId != null ? agg.runningByPackage.get(pkgId) ?? 0 : 0) +
      (d.ownCommand && !ownInPackage ? agg.runningByCommand.get(d.ownCommand.id) ?? 0 : 0);

    cards.push({
      id: `de:${d.id}`,
      name: d.name,
      comment: d.comment,
      iconUrl: d.iconUrl,
      pkg: d.pkg,
      desktopId: d.id,
      categories: d.categories,
      commands: [...cmds.values()].slice(0, COMMANDS_ON_CARD),
      commandCount,
      runningCount,
    });
  }

  for (const p of orphanPackages) {
    cards.push({
      id: `pkg:${p.id}`,
      name: p.name,
      comment: p.description,
      iconUrl: null,
      pkg: { id: p.id, type: p.type, name: p.name, version: p.version, section: p.section },
      desktopId: null,
      categories: "",
      commands: (agg.commandsByPackage.get(p.id) ?? []).slice(0, COMMANDS_ON_CARD),
      commandCount: agg.commandCountByPackage.get(p.id) ?? 0,
      runningCount: agg.runningByPackage.get(p.id) ?? 0,
    });
  }

  return cards;
}

export function applyProgramFilter(cards: ProgramCard[], f: ProgramFilter): ProgramCard[] {
  const q = f.q?.trim().toLowerCase();
  let out = cards.filter((c) => {
    if (q) {
      const hay = `${c.name}\n${c.comment}\n${c.pkg?.name ?? ""}\n${c.categories}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.type && c.pkg?.type !== f.type) return false;
    if (f.section && c.pkg?.section !== f.section) return false;
    if (f.category && !c.categories.toLowerCase().includes(f.category.toLowerCase())) return false;
    if (f.hasIcon && !c.iconUrl) return false;
    if (f.running && c.runningCount === 0) return false;
    return true;
  });

  switch (f.sort) {
    case "name_desc":
      out = out.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "running":
      out = out.sort((a, b) => b.runningCount - a.runningCount || a.name.localeCompare(b.name));
      break;
    default:
      out = out.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

export function paginate<T>(items: T[], page: number, pageSize: number): ListResp<T> {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function chipOf(cmd: {
  id: number;
  name: string;
  kind: string;
  doc: { summary: string } | null;
}): CommandChip {
  return { id: cmd.id, name: cmd.name, kind: cmd.kind, summary: cmd.doc?.summary ?? "" };
}

export async function loadProgramCards(db: Db, iconsRoot: string): Promise<ProgramCard[]> {
  const desktops = await db.desktopEntry.findMany({
    include: {
      package: true,
      command: { include: { doc: true } },
    },
    orderBy: { name: "asc" },
  });
  const orphanPackages = await db.package.findMany({
    where: { desktopEntries: { none: {} } },
    orderBy: { name: "asc" },
  });

  const pkgIds = [
    ...new Set([
      ...desktops.map((d) => d.packageId).filter((x): x is number => x != null),
      ...orphanPackages.map((p) => p.id),
    ]),
  ];
  const cmds = await db.command.findMany({
    where: { packageId: { in: pkgIds } },
    include: { doc: true },
  });
  const procCounts = await db.process.groupBy({
    by: ["packageId", "commandId"],
    _count: { _all: true },
  });

  const commandsByPackage = new Map<number, CommandChip[]>();
  const commandCountByPackage = new Map<number, number>();
  for (const c of cmds) {
    if (c.packageId == null) continue;
    const list = commandsByPackage.get(c.packageId) ?? [];
    list.push(chipOf(c));
    commandsByPackage.set(c.packageId, list);
    commandCountByPackage.set(c.packageId, (commandCountByPackage.get(c.packageId) ?? 0) + 1);
  }

  const runningByPackage = new Map<number, number>();
  const runningByCommand = new Map<number, number>();
  for (const row of procCounts) {
    const n = row._count._all;
    if (row.packageId != null) runningByPackage.set(row.packageId, (runningByPackage.get(row.packageId) ?? 0) + n);
    if (row.commandId != null) runningByCommand.set(row.commandId, (runningByCommand.get(row.commandId) ?? 0) + n);
  }

  return mergeProgramCards(
    desktops.map((d) => ({
      id: d.id,
      name: d.name,
      comment: d.comment,
      categories: d.categories,
      iconUrl: safeIconUrl(d.iconPath, iconsRoot, d.id),
      packageId: d.packageId,
      pkg: d.package
        ? {
            id: d.package.id,
            type: d.package.type,
            name: d.package.name,
            version: d.package.version,
            section: d.package.section,
          }
        : null,
      ownCommand: d.command ? chipOf(d.command) : null,
    })),
    orphanPackages.map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      version: p.version,
      section: p.section,
      description: p.description,
    })),
    { commandsByPackage, commandCountByPackage, runningByPackage, runningByCommand },
  );
}

export async function getPrograms(
  db: Db,
  filter: ProgramFilter,
  iconsRoot: string,
): Promise<ListResp<ProgramCard>> {
  const cards = await loadProgramCards(db, iconsRoot);
  const filtered = applyProgramFilter(cards, filter);
  return paginate(filtered, filter.page, filter.pageSize);
}

function processRowOf(p: {
  id: number;
  pid: number;
  user: string;
  cmdline: string;
  exePath: string;
  isKernel: boolean;
  startedAt: Date;
  package: { name: string } | null;
  command: { name: string } | null;
  snapshots: { state: string; cpuPercent: number | null; rssKb: number | null; uptimeSec: number }[];
}): ProcessRow {
  const s = p.snapshots[0];
  return {
    id: p.id,
    pid: p.pid,
    user: p.user,
    cmdline: p.cmdline,
    exePath: p.exePath,
    isKernel: p.isKernel,
    startedAt: p.startedAt.toISOString(),
    packageName: p.package?.name ?? null,
    commandName: p.command?.name ?? null,
    state: s?.state ?? "",
    cpuPercent: s?.cpuPercent ?? null,
    rssKb: s?.rssKb ?? null,
    uptimeSec: s?.uptimeSec ?? null,
  };
}

const PROC_INCLUDE = {
  package: { select: { name: true } },
  command: { select: { name: true } },
  snapshots: { orderBy: { observedAt: "desc" as const }, take: 1 },
};

export async function getProgram(db: Db, id: string, iconsRoot: string): Promise<ProgramDetail | null> {
  const [kind, rawId] = id.split(":");
  const num = Number.parseInt(rawId ?? "", 10);
  if (!Number.isFinite(num) || (kind !== "de" && kind !== "pkg")) return null;

  if (kind === "de") {
    const d = await db.desktopEntry.findUnique({
      where: { id: num },
      include: {
        package: true,
        command: { include: { doc: true } },
      },
    });
    if (!d) return null;
    const cards = await loadProgramCards(db, iconsRoot);
    const card = cards.find((c) => c.id === id);
    const pkgId = d.packageId;
    const commandsFull = await db.command.findMany({
      where: pkgId != null ? { OR: [{ packageId: pkgId }, { id: d.commandId ?? -1 }] } : { id: d.commandId ?? -1 },
      include: { doc: true },
    });
    const processes = await db.process.findMany({
      where: pkgId != null ? { OR: [{ packageId: pkgId }, { commandId: d.commandId ?? -1 }] } : { commandId: d.commandId ?? -1 },
      include: PROC_INCLUDE,
      orderBy: { pid: "asc" },
      take: 50,
    });
    return {
      ...(card ?? {
        id,
        name: d.name,
        comment: d.comment,
        iconUrl: safeIconUrl(d.iconPath, iconsRoot, d.id),
        pkg: d.package
          ? { id: d.package.id, type: d.package.type, name: d.package.name, version: d.package.version, section: d.package.section }
          : null,
        desktopId: d.id,
        categories: d.categories,
        commands: [],
        commandCount: commandsFull.length,
        runningCount: processes.length,
      }),
      desktop: {
        id: d.id,
        filePath: d.filePath,
        exec: d.exec,
        genericName: d.genericName,
        iconName: d.iconName,
        mimeTypes: d.mimeTypes,
        terminal: d.terminal,
        noDisplay: d.noDisplay,
        hidden: d.hidden,
        wmClass: d.wmClass,
      },
      package: d.package
        ? {
            id: d.package.id,
            type: d.package.type,
            name: d.package.name,
            version: d.package.version,
            architecture: d.package.architecture,
            maintainer: d.package.maintainer,
            description: d.package.description,
            section: d.package.section,
            origin: d.package.origin,
            installPath: d.package.installPath,
            meta: safeJson(d.package.meta),
          }
        : null,
      commandsFull: commandsFull.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        path: c.path,
        realPath: c.realPath,
        aliasOf: c.aliasOf,
        source: c.source,
        summary: c.doc?.summary ?? "",
        manPath: c.doc?.manPath ?? "",
        manSection: c.doc?.manSection ?? "",
      })),
      processes: processes.map(processRowOf),
    };
  }

  const p = await db.package.findUnique({ where: { id: num } });
  if (!p) return null;
  const cards = await loadProgramCards(db, iconsRoot);
  const card = cards.find((c) => c.id === id);
  const commandsFull = await db.command.findMany({
    where: { packageId: p.id },
    include: { doc: true },
  });
  const processes = await db.process.findMany({
    where: { packageId: p.id },
    include: PROC_INCLUDE,
    orderBy: { pid: "asc" },
    take: 50,
  });
  return {
    ...(card ?? {
      id,
      name: p.name,
      comment: p.description,
      iconUrl: null,
      pkg: { id: p.id, type: p.type, name: p.name, version: p.version, section: p.section },
      desktopId: null,
      categories: "",
      commands: [],
      commandCount: commandsFull.length,
      runningCount: processes.length,
    }),
    desktop: null,
    package: {
      id: p.id,
      type: p.type,
      name: p.name,
      version: p.version,
      architecture: p.architecture,
      maintainer: p.maintainer,
      description: p.description,
      section: p.section,
      origin: p.origin,
      installPath: p.installPath,
      meta: safeJson(p.meta),
    },
    commandsFull: commandsFull.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      path: c.path,
      realPath: c.realPath,
      aliasOf: c.aliasOf,
      source: c.source,
      summary: c.doc?.summary ?? "",
      manPath: c.doc?.manPath ?? "",
      manSection: c.doc?.manSection ?? "",
    })),
    processes: processes.map(processRowOf),
  };
}

export function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export { processRowOf, PROC_INCLUDE };
