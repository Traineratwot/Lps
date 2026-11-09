import { createDb, ensureSchema, type Db } from "../../core/db.ts";
import type { LpsConfig } from "../../core/config.ts";
import type { RawCommand, StageStats } from "../../core/types.ts";
import type { RawPackage } from "../../modules/distro/types.ts";
import { iconsDir } from "../../core/config.ts";
import { ProgressBar } from "../ui/progress.ts";
import { bold, dim, green, yellow } from "../ui/style.ts";
import { scanPathCommands } from "../../modules/commands/path-scan.ts";
import { scanAliases } from "../../modules/commands/aliases.ts";
import { scanBuiltins } from "../../modules/commands/builtins.ts";
import { detectDistro } from "../../modules/distro/detect.ts";
import { getManSummary } from "../../modules/docs/man.ts";
import { getHelpSummary, type HelpSummary } from "../../modules/docs/help.ts";
import { flatpakPathIndex, listFlatpakPackages } from "../../modules/sources/flatpak.ts";
import { listAppImagePackages } from "../../modules/sources/appimage.ts";
import { scanDesktopEntries } from "../../modules/desktop/entries.ts";
import { extractIcon, resolveIcon } from "../../modules/desktop/icons.ts";
import { execCommandName } from "../../core/util/text.ts";
import { bootTime, computeMetrics, listProcesses, startedAtIso } from "../../core/util/proc.ts";
import { listUsers } from "../../core/util/users.ts";

export type ScanOptions = {
  only?: string[];
};

type StageId = "commands" | "docs" | "packages" | "desktop" | "processes";

type Stage = {
  id: StageId;
  title: string;
  run: (ctx: ScanCtx) => Promise<StageStats>;
};

type LinkIndex = {
  packages: RawPackage[];
  /** file path → `${type}:${name}` */
  linkIndex: Map<string, string>;
};

export type ScanCtx = {
  config: LpsConfig;
  db: Db;
  distro: Awaited<ReturnType<typeof detectDistro>>;
  scanRunId: number;
  /** Shared across stages so flatpak/appimage are collected once per scan. */
  links?: LinkIndex;
};

const EMPTY_STATS = (): StageStats => ({ found: 0, written: 0, linked: 0, skipped: 0, errors: 0 });

// ---------------------------------------------------------------------------
// Stage: commands
// ---------------------------------------------------------------------------

async function upsertCommands(ctx: ScanCtx, commands: RawCommand[]): Promise<StageStats> {
  const stats = EMPTY_STATS();
  stats.found = commands.length;
  const bar = new ProgressBar("commands", commands.length);
  try {
    for (const cmd of commands) {
      await ctx.db.command.upsert({
        where: { name_path_kind: { name: cmd.name, path: cmd.path, kind: cmd.kind } },
        create: {
          name: cmd.name,
          kind: cmd.kind,
          path: cmd.path,
          realPath: cmd.realPath,
          aliasOf: cmd.aliasOf,
          source: cmd.source,
          isSymlink: cmd.isSymlink,
          size: cmd.size,
          mode: cmd.mode,
          ownerId: cmd.ownerId,
        },
        update: {
          realPath: cmd.realPath,
          aliasOf: cmd.aliasOf,
          source: cmd.source,
          isSymlink: cmd.isSymlink,
          size: cmd.size,
          mode: cmd.mode,
          ownerId: cmd.ownerId,
        },
      });
      stats.written++;
      bar.tick(cmd.name);
    }
    bar.done(`${stats.written} commands`);
  } catch (error) {
    stats.errors++;
    bar.fail(error instanceof Error ? error.message : String(error));
  }
  return stats;
}

async function runCommandsStage(ctx: ScanCtx): Promise<StageStats> {
  const collected: RawCommand[] = [];
  collected.push(...scanPathCommands());
  collected.push(...scanAliases(ctx.config.users));
  collected.push(...scanBuiltins());
  const alternatives = await ctx.distro.listAlternatives?.();
  if (alternatives) collected.push(...alternatives);
  return upsertCommands(ctx, collected);
}

// ---------------------------------------------------------------------------
// Stage: docs (man NAME summary, --help fallback)
// ---------------------------------------------------------------------------

async function runDocsStage(ctx: ScanCtx): Promise<StageStats> {
  const stats = EMPTY_STATS();
  const commands = await ctx.db.command.findMany({
    select: { id: true, name: true, path: true, realPath: true, kind: true, aliasOf: true },
    orderBy: { name: "asc" },
  });
  stats.found = commands.length;
  const bar = new ProgressBar("docs", commands.length);
  // symlinked binaries share one --help run
  const helpCache = new Map<string, HelpSummary | null>();

  try {
    for (const cmd of commands) {
      let summary = "";
      let manPath = "";
      let manSection = "";
      let source = "none";
      let helpFlag = "";

      if (cmd.kind === "alias") {
        summary = cmd.aliasOf;
      } else {
        const man = getManSummary(cmd.name);
        if (man?.summary) {
          summary = man.summary;
          manPath = man.path;
          manSection = man.section;
          source = "man";
        } else {
          const cacheKey = cmd.realPath || cmd.path || cmd.name;
          let help = helpCache.get(cacheKey);
          if (help === undefined) {
            help = getHelpSummary(cmd.name, cmd.path, cmd.kind as RawCommand["kind"]);
            helpCache.set(cacheKey, help);
          }
          if (help) {
            summary = help.summary;
            helpFlag = help.flag;
            source = "help";
          }
          if (man) {
            manPath = man.path;
            manSection = man.section;
            if (source === "none") source = "man";
          }
        }
      }

      await ctx.db.commandDoc.upsert({
        where: { commandId: cmd.id },
        create: { commandId: cmd.id, summary, manPath, manSection, source, helpFlag },
        update: { summary, manPath, manSection, source, helpFlag },
      });
      stats.written++;
      bar.tick(cmd.name);
    }
    bar.done(`${stats.written} docs`);
  } catch (error) {
    stats.errors++;
    bar.fail(error instanceof Error ? error.message : String(error));
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Stage: packages (deb + flatpak + appimage)
// ---------------------------------------------------------------------------

async function collectPackages(ctx: ScanCtx): Promise<LinkIndex> {
  if (ctx.links) return ctx.links;
  const packages: RawPackage[] = [];
  const linkIndex = new Map<string, string>();

  const debPackages = await ctx.distro.listPackages();
  packages.push(...debPackages);
  for (const [path, name] of await ctx.distro.pathIndex()) {
    linkIndex.set(path, `deb:${name}`);
  }

  const flatpakPackages = await listFlatpakPackages();
  packages.push(...flatpakPackages);
  for (const [path, appId] of await flatpakPathIndex()) {
    linkIndex.set(path, `flatpak:${appId}`);
  }

  const appImages = await listAppImagePackages();
  packages.push(...appImages);
  for (const pkg of appImages) {
    if (pkg.installPath) linkIndex.set(pkg.installPath, `appimage:${pkg.name}`);
  }

  ctx.links = { packages, linkIndex };
  return ctx.links;
}

async function upsertPackages(ctx: ScanCtx, raw: RawPackage[]): Promise<{ stats: StageStats; ids: Map<string, number> }> {
  const stats = EMPTY_STATS();
  stats.found = raw.length;
  const bar = new ProgressBar("packages", raw.length);
  const ids = new Map<string, number>();
  try {
    for (const pkg of raw) {
      const row = await ctx.db.package.upsert({
        where: { type_name: { type: pkg.type, name: pkg.name } },
        create: {
          type: pkg.type,
          name: pkg.name,
          version: pkg.version,
          architecture: pkg.architecture,
          status: pkg.status,
          maintainer: pkg.maintainer,
          description: pkg.description,
          section: pkg.section,
          origin: pkg.origin,
          installPath: pkg.installPath,
          meta: JSON.stringify(pkg.meta ?? {}),
        },
        update: {
          version: pkg.version,
          architecture: pkg.architecture,
          status: pkg.status,
          maintainer: pkg.maintainer,
          description: pkg.description,
          section: pkg.section,
          origin: pkg.origin,
          installPath: pkg.installPath,
          meta: JSON.stringify(pkg.meta ?? {}),
        },
      });
      ids.set(`${pkg.type}:${pkg.name}`, row.id);
      stats.written++;
      bar.tick(pkg.name);
    }
    bar.done(`${stats.written} packages`);
  } catch (error) {
    stats.errors++;
    bar.fail(error instanceof Error ? error.message : String(error));
  }
  return { stats, ids };
}

async function linkCommandsToPackages(
  ctx: ScanCtx,
  ids: Map<string, number>,
  linkIndex: Map<string, string>,
): Promise<number> {
  const commands = await ctx.db.command.findMany({
    select: { id: true, path: true, realPath: true, packageId: true },
  });
  const bar = new ProgressBar("link cmd→pkg", commands.length);
  let linked = 0;
  for (const cmd of commands) {
    const ref = linkIndex.get(cmd.realPath) ?? (cmd.path ? linkIndex.get(cmd.path) : undefined);
    const pkgId = ref ? ids.get(ref) : undefined;
    if (pkgId && pkgId !== cmd.packageId) {
      await ctx.db.command.update({ where: { id: cmd.id }, data: { packageId: pkgId } });
      linked++;
    }
    bar.tick();
  }
  bar.done(`${linked} linked`);
  return linked;
}

async function runPackagesStage(ctx: ScanCtx): Promise<StageStats> {
  const { packages, linkIndex } = await collectPackages(ctx);
  const { stats, ids } = await upsertPackages(ctx, packages);
  // AppImage files outside PATH are commands in their own right
  await upsertAppImageCommands(ctx, packages);
  stats.linked = await linkCommandsToPackages(ctx, ids, linkIndex);
  return stats;
}

async function upsertAppImageCommands(ctx: ScanCtx, packages: RawPackage[]): Promise<void> {
  for (const pkg of packages) {
    if (pkg.type !== "appimage" || !pkg.installPath) continue;
    const name = pkg.installPath.split("/").pop() ?? pkg.name;
    await ctx.db.command.upsert({
      where: { name_path_kind: { name, path: pkg.installPath, kind: "exec" } },
      create: {
        name,
        kind: "exec",
        path: pkg.installPath,
        realPath: pkg.installPath,
        source: "appimage",
        isSymlink: false,
      },
      update: { realPath: pkg.installPath, source: "appimage" },
    });
  }
}

// ---------------------------------------------------------------------------
// Stage: desktop (.desktop entries + icons)
// ---------------------------------------------------------------------------

async function runDesktopStage(ctx: ScanCtx): Promise<StageStats> {
  const stats = EMPTY_STATS();
  const entries = scanDesktopEntries();
  stats.found = entries.length;

  const { linkIndex } = await collectPackages(ctx);
  const pkgRows = await ctx.db.package.findMany({ select: { id: true, type: true, name: true } });
  const pkgIds = new Map(pkgRows.map((p) => [`${p.type}:${p.name}`, p.id]));

  const commands = await ctx.db.command.findMany({
    select: { id: true, name: true, path: true, kind: true, packageId: true },
  });
  const byPath = new Map<string, number>();
  const byName = new Map<string, { id: number; packageId: number | null }>();
  for (const cmd of commands) {
    if (cmd.path) byPath.set(cmd.path, cmd.id);
    const existing = byName.get(cmd.name);
    if (!existing || (cmd.packageId && !existing.packageId)) {
      byName.set(cmd.name, { id: cmd.id, packageId: cmd.packageId });
    }
  }

  const outDir = iconsDir(ctx.config);
  const bar = new ProgressBar("desktop", entries.length);

  try {
    for (const entry of entries) {
      let iconPath = "";
      if (!ctx.config.noIcons) {
        const resolved = resolveIcon(entry.iconName);
        if (resolved.sourcePath) iconPath = extractIcon(resolved.sourcePath, outDir);
      }

      // link → package: by desktop file path, then by exec command's package
      const pkgRef = linkIndex.get(entry.filePath);
      let packageId = pkgRef ? pkgIds.get(pkgRef) : undefined;
      const execName = execCommandName(entry.exec);
      let commandId: number | undefined;
      if (execName) {
        commandId = entry.exec.startsWith("/")
          ? byPath.get(execName)
          : byName.get(execName)?.id;
      }
      if (!packageId && commandId) {
        const cmd = commands.find((c) => c.id === commandId);
        if (cmd?.packageId) packageId = cmd.packageId;
      }

      await ctx.db.desktopEntry.upsert({
        where: { filePath: entry.filePath },
        create: {
          filePath: entry.filePath,
          name: entry.name,
          genericName: entry.genericName,
          comment: entry.comment,
          exec: entry.exec,
          tryExec: entry.tryExec,
          iconName: entry.iconName,
          iconPath,
          categories: entry.categories,
          mimeTypes: entry.mimeTypes,
          terminal: entry.terminal,
          noDisplay: entry.noDisplay,
          hidden: entry.hidden,
          wmClass: entry.wmClass,
          meta: JSON.stringify(entry.meta ?? {}),
          packageId: packageId ?? null,
          commandId: commandId ?? null,
        },
        update: {
          name: entry.name,
          genericName: entry.genericName,
          comment: entry.comment,
          exec: entry.exec,
          tryExec: entry.tryExec,
          iconName: entry.iconName,
          iconPath,
          categories: entry.categories,
          mimeTypes: entry.mimeTypes,
          terminal: entry.terminal,
          noDisplay: entry.noDisplay,
          hidden: entry.hidden,
          wmClass: entry.wmClass,
          meta: JSON.stringify(entry.meta ?? {}),
          packageId: packageId ?? null,
          commandId: commandId ?? null,
        },
      });
      stats.written++;
      if (packageId) stats.linked++;
      bar.tick(entry.name);
    }
    bar.done(`${stats.written} entries, ${stats.linked} linked`);
  } catch (error) {
    stats.errors++;
    bar.fail(error instanceof Error ? error.message : String(error));
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Stage: processes (one-shot snapshot of /proc)
// ---------------------------------------------------------------------------

async function runProcessesStage(ctx: ScanCtx): Promise<StageStats> {
  const stats = EMPTY_STATS();
  const procs = listProcesses();
  stats.found = procs.length;

  const { linkIndex } = await collectPackages(ctx);
  const pkgRows = await ctx.db.package.findMany({ select: { id: true, type: true, name: true } });
  const pkgIds = new Map(pkgRows.map((p) => [`${p.type}:${p.name}`, p.id]));

  const commands = await ctx.db.command.findMany({
    select: { id: true, name: true, path: true, realPath: true, kind: true, packageId: true },
  });
  const byRealPath = new Map<string, number>();
  const byPath = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const cmd of commands) {
    if (cmd.realPath && !byRealPath.has(cmd.realPath)) byRealPath.set(cmd.realPath, cmd.id);
    if (cmd.path && !byPath.has(cmd.path)) byPath.set(cmd.path, cmd.id);
    if (cmd.kind === "exec" && !byName.has(cmd.name)) byName.set(cmd.name, cmd.id);
  }

  const userByUid = new Map(listUsers().map((u) => [u.uid, u.name]));
  const btime = bootTime();
  const nowSec = Date.now() / 1000;
  const observedAt = new Date();
  const bar = new ProgressBar("processes", procs.length);

  try {
    for (const proc of procs) {
      const startedAt = new Date(startedAtIso(proc, btime));
      const { uptimeSec, cpuPercent } = computeMetrics(proc, nowSec, btime);

      const cmdName = proc.cmdline.split(/\s+/)[0]?.split("/").pop() || proc.comm;
      const commandId =
        (proc.exePath ? (byRealPath.get(proc.exePath) ?? byPath.get(proc.exePath)) : undefined) ??
        byName.get(cmdName);

      const pkgRef = proc.exePath ? linkIndex.get(proc.exePath) : undefined;
      let packageId = pkgRef ? pkgIds.get(pkgRef) : undefined;
      if (!packageId && commandId) {
        packageId = commands.find((c) => c.id === commandId)?.packageId ?? undefined;
      }

      const row = await ctx.db.process.upsert({
        where: { pid_startedAt: { pid: proc.pid, startedAt } },
        create: {
          pid: proc.pid,
          startedAt,
          ppid: proc.ppid,
          uid: proc.uid,
          user: proc.uid != null ? (userByUid.get(proc.uid) ?? "") : "",
          cmdline: proc.cmdline,
          exePath: proc.exePath,
          isKernel: proc.isKernel,
          commandId: commandId ?? null,
          packageId: packageId ?? null,
        },
        update: {
          ppid: proc.ppid,
          uid: proc.uid,
          user: proc.uid != null ? (userByUid.get(proc.uid) ?? "") : "",
          cmdline: proc.cmdline,
          exePath: proc.exePath,
          isKernel: proc.isKernel,
          commandId: commandId ?? null,
          packageId: packageId ?? null,
        },
      });

      await ctx.db.processSnapshot.create({
        data: {
          scanRunId: ctx.scanRunId,
          processId: row.id,
          observedAt,
          uptimeSec,
          cpuPercent,
          rssKb: proc.rssKb,
          state: proc.state,
          threads: proc.numThreads,
        },
      });

      stats.written++;
      if (commandId || packageId) stats.linked++;
      bar.tick(proc.comm);
    }
    bar.done(`${stats.written} processes, ${stats.linked} linked`);
  } catch (error) {
    stats.errors++;
    bar.fail(error instanceof Error ? error.message : String(error));
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

const STAGES: Stage[] = [
  { id: "commands", title: "commands", run: runCommandsStage },
  { id: "docs", title: "docs", run: runDocsStage },
  { id: "packages", title: "packages", run: runPackagesStage },
  { id: "desktop", title: "desktop", run: runDesktopStage },
  { id: "processes", title: "processes", run: runProcessesStage },
];

export async function runScan(config: LpsConfig, options: ScanOptions = {}): Promise<void> {
  await ensureSchema(config.dbPath);
  const db = createDb(config.dbPath);

  const selected = options.only?.length
    ? STAGES.filter((s) => options.only!.includes(s.id))
    : STAGES.filter((s) => !(config.skipDocs && s.id === "docs"));
  if (selected.length === 0) {
    console.error(yellow(`No stages selected. Available: ${STAGES.map((s) => s.id).join(", ")}`));
    return;
  }

  const distro = await detectDistro();
  console.log(
    `${dim("distro:")} ${bold(distro.name)}  ${dim("db:")} ${config.dbPath}  ${dim("users:")} ${config.users.join(",")}`,
  );

  const scanRun = await db.scanRun.create({
    data: {
      startedAt: new Date(),
      stages: JSON.stringify(selected.map((s) => s.id)),
    },
  });

  const ctx: ScanCtx = { config, db, distro, scanRunId: scanRun.id };
  const totals: Record<string, StageStats> = {};

  for (const stage of selected) {
    const stats = await stage.run(ctx);
    totals[stage.id] = stats;
  }

  await db.scanRun.update({
    where: { id: scanRun.id },
    data: {
      finishedAt: new Date(),
      stats: JSON.stringify(totals),
    },
  });

  console.log(
    `${green("✓")} scan ${dim(`#${scanRun.id}`)} done: ` +
      Object.entries(totals)
        .map(([id, s]) => (s.linked ? `${id}=${s.written} (${s.linked} linked)` : `${id}=${s.written}`))
        .join("  "),
  );

  await db.$disconnect();
}
