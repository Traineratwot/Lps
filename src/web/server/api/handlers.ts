import type { LpsConfig } from "../../../core/config.ts";
import { iconsDir } from "../../../core/config.ts";
import type { Db } from "../../../core/db.ts";
import type {
  CommandDetail,
  CommandRow,
  DesktopRow,
  ListResp,
  ProcessDetail,
  ProcessRow,
  ServiceDetail,
  ServiceRow,
  StatsResp,
} from "../../types.ts";
import type { ApiRoute } from "./router.ts";
import { renderHelpPage, renderManPage, type DocText } from "./docs.ts";
import {
  getProgram,
  getPrograms,
  isInsideDir,
  jsonList,
  PROC_INCLUDE,
  processRowOf,
  safeIconUrl,
} from "./programs.ts";

export type ApiCtx = {
  db: Db;
  config: LpsConfig;
  readonly: boolean;
};

const MAX_PAGE_SIZE = 100;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function num(query: Record<string, string>, key: string, fallback: number): number {
  const v = Number.parseInt(query[key] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function paging(query: Record<string, string>): { page: number; pageSize: number } {
  return {
    page: num(query, "page", 1),
    pageSize: Math.min(num(query, "pageSize", 24), MAX_PAGE_SIZE),
  };
}

function bool(query: Record<string, string>, key: string): boolean {
  return query[key] === "true" || query[key] === "1";
}

/**
 * Sorts DTO rows by any displayed key (including computed ones like
 * cpuPercent or packageName). Nulls always sort last. List sizes here are
 * small (a few thousand rows), so sorting in memory keeps every column
 * sortable without a per-field ORDER BY allowlist.
 */
function sortRows<T extends Record<string, unknown>>(rows: T[], query: Record<string, string>): T[] {
  const key = query.sort;
  if (!key) return rows;
  const dir = query.order === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb), "ru") * dir;
  });
}

function pageSlice<T>(rows: T[], query: Record<string, string>): T[] {
  const { page, pageSize } = paging(query);
  return rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
}

const MIME: Record<string, string> = { png: "image/png", svg: "image/svg+xml", xpm: "image/x-xpmi", jpg: "image/jpeg" };

export async function handleApi(ctx: ApiCtx, route: ApiRoute): Promise<Response> {
  const { db } = ctx;
  switch (route.name) {
    case "health":
      return json({ ok: true, dbPath: ctx.config.dbPath, readonly: ctx.readonly });

    case "stats":
      return json(await getStats(db));

    case "programs":
      return json(
        await getPrograms(
          db,
          {
            q: route.query.q,
            type: route.query.type,
            section: route.query.section,
            category: route.query.category,
            hasIcon: bool(route.query, "hasIcon"),
            running: bool(route.query, "running"),
            sort: route.query.sort,
            ...paging(route.query),
          },
          iconsDir(ctx.config),
        ),
      );

    case "program": {
      const detail = await getProgram(db, route.id, iconsDir(ctx.config));
      return detail ? json(detail) : json({ error: "not found" }, 404);
    }

    case "commands":
      return json(await listCommands(db, route.query));

    case "command": {
      const detail = await commandDetail(db, route.id);
      return detail ? json(detail) : json({ error: "not found" }, 404);
    }

    case "commandDoc": {
      const doc = await commandDocText(db, route.id, route.query.kind ?? "man");
      return doc ? json(doc) : json({ error: "not found" }, 404);
    }

    case "processes":
      return json(await listProcesses(db, route.query));

    case "process": {
      const detail = await processDetail(db, route.id);
      return detail ? json(detail) : json({ error: "not found" }, 404);
    }

    case "services":
      return json(await listServices(db, route.query));

    case "service": {
      const detail = await serviceDetail(db, route.id);
      return detail ? json(detail) : json({ error: "not found" }, 404);
    }

    case "desktop":
      return json(await listDesktop(db, route.query, iconsDir(ctx.config)));

    case "desktopItem": {
      const rows = await listDesktop(db, { id: String(route.id) }, iconsDir(ctx.config));
      return rows.items[0] ? json(rows.items[0]) : json({ error: "not found" }, 404);
    }

    case "icon":
      return iconResponse(ctx, route.id);
  }
}

async function getStats(db: Db): Promise<StatsResp> {
  const [commands, packages, desktopEntries, processes, services, byType, byKind, lastScan] = await Promise.all([
    db.command.count(),
    db.package.count(),
    db.desktopEntry.count(),
    db.process.count(),
    db.systemdService.count(),
    db.package.groupBy({ by: ["type"], _count: { _all: true } }),
    db.command.groupBy({ by: ["kind"], _count: { _all: true } }),
    db.scanRun.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
  ]);
  return {
    commands,
    packages,
    desktopEntries,
    processes,
    services,
    packagesByType: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
    commandsByKind: Object.fromEntries(byKind.map((r) => [r.kind, r._count._all])),
    lastScan: lastScan?.startedAt.toISOString() ?? null,
  };
}

/** Primary executable path of a command row. */
function primaryPath(cmd: { realPath: string; paths: string }): string {
  return cmd.realPath || jsonList(cmd.paths)[0] || "";
}

/** First alias expansion ("name=value" → value). */
function firstAlias(aliasesJson: string): string {
  const first = jsonList(aliasesJson)[0] ?? "";
  const eq = first.indexOf("=");
  return eq >= 0 ? first.slice(eq + 1) : first;
}

async function commandDocText(db: Db, id: number, kind: string): Promise<DocText | null> {
  const cmd = await db.command.findUnique({
    where: { id },
    include: { doc: true },
  });
  if (!cmd) return null;
  if (kind === "help") {
    return renderHelpPage(cmd.name, primaryPath(cmd), cmd.kind, firstAlias(cmd.aliases));
  }
  return renderManPage(cmd.name, cmd.doc?.manPath ?? "");
}

async function listCommands(db: Db, query: Record<string, string>): Promise<ListResp<CommandRow>> {
  const { page, pageSize } = paging(query);
  const where = {
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q } },
            { names: { contains: query.q } },
            { paths: { contains: query.q } },
            { aliases: { contains: query.q } },
          ],
        }
      : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(bool(query, "orphan") ? { packageId: null } : {}),
  };
  const rows = await db.command.findMany({
    where,
    include: { doc: true, package: { select: { name: true } }, _count: { select: { processes: true } } },
    orderBy: { name: "asc" },
  });
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    path: r.realPath || jsonList(r.paths)[0] || "",
    paths: jsonList(r.paths),
    aliases: jsonList(r.aliases),
    summary: r.doc?.summary ?? "",
    packageName: r.package?.name ?? null,
    processCount: r._count.processes,
  }));
  return {
    items: pageSlice(sortRows(items, query), query),
    total: items.length,
    page,
    pageSize,
  };
}

async function commandDetail(db: Db, id: number): Promise<CommandDetail | null> {
  const r = await db.command.findUnique({
    where: { id },
    include: {
      doc: true,
      package: true,
      desktopEntries: { select: { id: true, name: true, filePath: true } },
      processes: { include: PROC_INCLUDE, orderBy: { pid: "asc" }, take: 30 },
    },
  });
  if (!r) return null;
  const serviceRows = await db.systemdService.findMany({
    where: { OR: [{ commandId: r.id }, ...(r.packageId ? [{ packageId: r.packageId }] : [])] },
    orderBy: [{ activeState: "desc" }, { name: "asc" }],
  });
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    path: r.realPath || jsonList(r.paths)[0] || "",
    paths: jsonList(r.paths),
    aliases: jsonList(r.aliases),
    names: jsonList(r.names),
    realPath: r.realPath,
    source: r.source,
    summary: r.doc?.summary ?? "",
    packageName: r.package?.name ?? null,
    processCount: r.processes.length,
    doc: r.doc
      ? {
          summary: r.doc.summary,
          manPath: r.doc.manPath,
          manSection: r.doc.manSection,
          source: r.doc.source,
          helpFlag: r.doc.helpFlag,
        }
      : null,
    package: r.package
      ? {
          id: r.package.id,
          type: r.package.type,
          name: r.package.name,
          version: r.package.version,
          section: r.package.section,
        }
      : null,
    desktopEntries: r.desktopEntries,
    processes: r.processes.map(processRowOf),
    services: serviceRows.map((sv) => ({
      id: sv.id,
      name: sv.name,
      description: sv.description,
      activeState: sv.activeState,
      enabledState: sv.enabledState,
      execStartPath: sv.execStartPath,
      mainPid: sv.mainPid,
    })),
  };
}

async function listProcesses(db: Db, query: Record<string, string>): Promise<ListResp<ProcessRow>> {
  const { page, pageSize } = paging(query);
  const where = {
    ...(query.q
      ? { OR: [{ cmdline: { contains: query.q } }, { exePath: { contains: query.q } }, { user: { contains: query.q } }] }
      : {}),
    ...(query.user ? { user: query.user } : {}),
  };
  const rows = await db.process.findMany({
    where,
    include: PROC_INCLUDE,
    orderBy: [{ pid: "asc" }],
  });
  const items = rows.map(processRowOf);
  return {
    items: pageSlice(sortRows(items, query), query),
    total: items.length,
    page,
    pageSize,
  };
}

async function processDetail(db: Db, id: number): Promise<ProcessDetail | null> {
  const r = await db.process.findUnique({
    where: { id },
    include: {
      package: { select: { name: true } },
      command: { select: { name: true } },
      snapshots: { orderBy: { observedAt: "desc" }, take: 50 },
    },
  });
  if (!r) return null;
  const row = processRowOf({ ...r, snapshots: r.snapshots.slice(0, 1) });
  return {
    ...row,
    ppid: r.ppid,
    uid: r.uid,
    snapshots: r.snapshots.map((s) => ({
      id: s.id,
      observedAt: s.observedAt.toISOString(),
      uptimeSec: s.uptimeSec,
      cpuPercent: s.cpuPercent,
      rssKb: s.rssKb,
      state: s.state,
      threads: s.threads,
    })),
  };
}

async function listServices(db: Db, query: Record<string, string>): Promise<ListResp<ServiceRow>> {
  const { page, pageSize } = paging(query);
  const where = {
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q } },
            { description: { contains: query.q } },
            { execStart: { contains: query.q } },
          ],
        }
      : {}),
    ...(query.active ? { activeState: query.active } : {}),
    ...(query.enabled ? { enabledState: query.enabled } : {}),
  };
  const rows = await db.systemdService.findMany({
    where,
    include: { package: { select: { name: true } }, command: { select: { name: true } } },
    orderBy: [{ activeState: "desc" }, { name: "asc" }],
  });
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    activeState: r.activeState,
    subState: r.subState,
    enabledState: r.enabledState,
    execStartPath: r.execStartPath,
    mainPid: r.mainPid,
    packageName: r.package?.name ?? null,
    commandName: r.command?.name ?? null,
  }));
  return {
    items: pageSlice(sortRows(items, query), query),
    total: items.length,
    page,
    pageSize,
  };
}

async function serviceDetail(db: Db, id: number): Promise<ServiceDetail | null> {
  const r = await db.systemdService.findUnique({
    where: { id },
    include: {
      package: true,
      command: { include: { doc: true, package: { select: { name: true } }, _count: { select: { processes: true } } } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    activeState: r.activeState,
    subState: r.subState,
    enabledState: r.enabledState,
    execStartPath: r.execStartPath,
    mainPid: r.mainPid,
    packageName: r.package?.name ?? null,
    commandName: r.command?.name ?? null,
    unitPath: r.unitPath,
    execStart: r.execStart,
    user: r.user,
    wantedBy: r.wantedBy,
    package: r.package
      ? {
          id: r.package.id,
          type: r.package.type,
          name: r.package.name,
          version: r.package.version,
          section: r.package.section,
        }
      : null,
    command: r.command
      ? {
          id: r.command.id,
          name: r.command.name,
          kind: r.command.kind,
          path: r.command.realPath || jsonList(r.command.paths)[0] || "",
          paths: jsonList(r.command.paths),
          aliases: jsonList(r.command.aliases),
          summary: r.command.doc?.summary ?? "",
          packageName: r.command.package?.name ?? null,
          processCount: r.command._count.processes,
        }
      : null,
  };
}

async function listDesktop(
  db: Db,
  query: Record<string, string>,
  iconsRoot: string,
): Promise<ListResp<DesktopRow>> {
  const { page, pageSize } = paging(query);
  const where = {
    ...(query.id
      ? { id: Number.parseInt(query.id, 10) }
      : {
          ...(query.q ? { name: { contains: query.q } } : {}),
          ...(query.category ? { categories: { contains: query.category } } : {}),
          ...(query.terminal ? { terminal: query.terminal === "true" } : {}),
          ...(bool(query, "hasIcon") ? { iconPath: { not: "" } } : {}),
        }),
  };
  const [total, rows] = await Promise.all([
    db.desktopEntry.count({ where }),
    db.desktopEntry.findMany({
      where,
      include: { package: { select: { name: true } }, command: { select: { name: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      comment: r.comment,
      exec: r.exec,
      iconName: r.iconName,
      iconUrl: safeIconUrl(r.iconPath, iconsRoot, r.id),
      categories: r.categories,
      terminal: r.terminal,
      noDisplay: r.noDisplay,
      hidden: r.hidden,
      filePath: r.filePath,
      packageName: r.package?.name ?? null,
      commandName: r.command?.name ?? null,
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * Serves an extracted icon. The stored iconPath must stay inside iconsDir —
 * path-containment check before touching the filesystem.
 */
async function iconResponse(ctx: ApiCtx, desktopEntryId: number): Promise<Response> {
  const row = await ctx.db.desktopEntry.findUnique({
    where: { id: desktopEntryId },
    select: { iconPath: true },
  });
  const iconPath = row?.iconPath;
  if (!iconPath) return json({ error: "not found" }, 404);

  const root = iconsDir(ctx.config);
  if (!isInsideDir(iconPath, root)) {
    return json({ error: "not found" }, 404);
  }
  const ext = iconPath.split(".").pop()?.toLowerCase() ?? "";
  const type = MIME[ext] ?? "application/octet-stream";
  const file = Bun.file(iconPath);
  return new Response(file, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" } });
}
