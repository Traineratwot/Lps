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
import { mergeCommands, type HashFn, type MergedCommand } from "../../modules/commands/merge.ts";
import { fileKey, hashFile, syntheticHash } from "../../core/util/hash.ts";
import { detectDistro } from "../../modules/distro/detect.ts";
import { getManSummary } from "../../modules/docs/man.ts";
import { getHelpSummary, type HelpSummary } from "../../modules/docs/help.ts";
import { flatpakPathIndex, listFlatpakPackages } from "../../modules/sources/flatpak.ts";
import { listAppImagePackages } from "../../modules/sources/appimage.ts";
import { listSnapPackages, snapPathIndex } from "../../modules/sources/snap.ts";
import { scanDesktopEntries } from "../../modules/desktop/entries.ts";
import { extractIcon, resolveIcon } from "../../modules/desktop/icons.ts";
import { execCommandName } from "../../core/util/text.ts";
import { bootTime, computeMetrics, listProcesses, startedAtIso } from "../../core/util/proc.ts";
import { listUsers } from "../../core/util/users.ts";
import { listSystemdServices } from "../../modules/systemd/collect.ts";

export type ScanOptions = {
  only?: string[];
};

type StageId = "commands" | "docs" | "packages" | "services" | "desktop" | "processes";

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

/** Builds a hasher: sha256 of content, memoized per (dev,ino,size,mtime). */
function makeCommandHasher(reuse: Map<string, string>): HashFn {
  const cache = new Map<string, string>();
  return (raw) => {
    if (raw.kind === "alias") return syntheticHash("alias", raw.name);
    if (raw.kind === "builtin" || !raw.path) return syntheticHash("builtin", raw.name);
    const key =
      raw.dev != null && raw.ino != null
        ? fileKey(raw.dev, raw.ino, raw.size ?? 0, raw.mtimeMs ?? 0)
        : null;
    if (key) {
      const hit = cache.get(key) ?? reuse.get(key);
      if (hit) {
        cache.set(key, hit);
        return hit;
      }
    }
    const hash = hashFile(raw.realPath || raw.path);
    if (hash && key) cache.set(key, hash);
    return hash;
  };
}

async function upsertCommands(ctx: ScanCtx, commands: MergedCommand[]): Promise<StageStats> {
  const stats = EMPTY_STATS();
  stats.found = commands.length;
  const bar = new ProgressBar("commands", commands.length);
  try {
    for (const cmd of commands) {
      const names = JSON.stringify(cmd.names);
      const paths = JSON.stringify(cmd.paths);
      const aliases = JSON.stringify(cmd.aliases);
      await ctx.db.command.upsert({
        where: { hash: cmd.hash },
        create: {
          hash: cmd.hash,
          name: cmd.name,
          names,
          paths,
          aliases,
          kind: cmd.kind,
          source: cmd.source,
          realPath: cmd.realPath,
          isSymlink: cmd.isSymlink,
          size: cmd.size,
          mode: cmd.mode,
          ownerId: cmd.ownerId,
          dev: cmd.dev,
          inode: cmd.inode,
          mtimeMs: cmd.mtimeMs,
        },
        update: {
          name: cmd.name,
          names,
          paths,
          aliases,
          kind: cmd.kind,
          source: cmd.source,
          realPath: cmd.realPath,
          isSymlink: cmd.isSymlink,
          size: cmd.size,
          mode: cmd.mode,
          ownerId: cmd.ownerId,
          dev: cmd.dev,
          inode: cmd.inode,
          mtimeMs: cmd.mtimeMs,
        },
      });
      stats.written++;
      bar.tick(cmd.name);
    }
    bar.done(`${stats.written} unique commands`);
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

  // reuse hashes of unchanged files from the previous scan
  const reuse = new Map<string, string>();
  for (const row of await ctx.db.command.findMany({ select: { hash: true, dev: true, inode: true, size: true, mtimeMs: true } })) {
    if (row.dev != null && row.inode != null && row.mtimeMs != null) {
      reuse.set(fileKey(row.dev, row.inode, row.size ?? 0, row.mtimeMs), row.hash);
    }
  }

  return upsertCommands(ctx, mergeCommands(collected, makeCommandHasher(reuse)));
}

// ---------------------------------------------------------------------------
// Stage: docs (man NAME summary, --help fallback)
// ---------------------------------------------------------------------------

function firstAliasExpansion(aliasesJson: string): string {
  try {
    const list = JSON.parse(aliasesJson) as string[];
    const first = list[0] ?? "";
    const eq = first.indexOf("=");
    return eq >= 0 ? first.slice(eq + 1) : first;
  } catch {
    return "";
  }
}

function primaryPathOf(row: { realPath: string; paths: string }): string {
  if (row.realPath) return row.realPath;
  try {
    return (JSON.parse(row.paths) as string[])[0] ?? "";
  } catch {
    return "";
  }
}

async function runDocsStage(ctx: ScanCtx): Promise<StageStats> {
  const stats = EMPTY_STATS();
  const commands = await ctx.db.command.findMany({
    select: { id: true, name: true, realPath: true, paths: true, kind: true, aliases: true },
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
        summary = firstAliasExpansion(cmd.aliases);
      } else {
        const man = getManSummary(cmd.name);
        if (man?.summary) {
          summary = man.summary;
          manPath = man.path;
          manSection = man.section;
          source = "man";
        } else {
          const cacheKey = cmd.realPath || cmd.name;
          let help = helpCache.get(cacheKey);
          if (help === undefined) {
            help = getHelpSummary(cmd.name, primaryPathOf(cmd), cmd.kind as RawCommand["kind"]);
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

  const snaps = await listSnapPackages();
  packages.push(...snaps);
  for (const [path, name] of await snapPathIndex(snaps.map((s) => s.name))) {
    linkIndex.set(path, `snap:${name}`);
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
    select: { id: true, paths: true, realPath: true, packageId: true },
  });
  const bar = new ProgressBar("link cmd→pkg", commands.length);
  let linked = 0;
  for (const cmd of commands) {
    const ref = lookupLink(linkIndex, cmd.realPath, cmd.paths);
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

/** Parses a JSON string[] column; tolerates empty/legacy values. */
function jsonList(json: string): string[] {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? (list as string[]) : [];
  } catch {
    return [];
  }
}

/** First hit in the link index among realPath and every recorded path. */
function lookupLink(linkIndex: Map<string, string>, realPath: string, pathsJson: string): string | undefined {
  if (realPath) {
    const hit = linkIndex.get(realPath);
    if (hit) return hit;
  }
  let paths: string[] = [];
  try {
    paths = JSON.parse(pathsJson) as string[];
  } catch {
    // empty/legacy value
  }
  for (const p of paths) {
    const hit = linkIndex.get(p);
    if (hit) return hit;
  }
  return undefined;
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
    const hash = hashFile(pkg.installPath) ?? syntheticHash("appimage", pkg.installPath);
    await ctx.db.command.upsert({
      where: { hash },
      create: {
        hash,
        name,
        names: JSON.stringify([name]),
        paths: JSON.stringify([pkg.installPath]),
        aliases: "[]",
        kind: "exec",
        source: "appimage",
        realPath: pkg.installPath,
        isSymlink: false,
      },
      update: {
        name,
        names: JSON.stringify([name]),
        paths: JSON.stringify([pkg.installPath]),
        source: "appimage",
        realPath: pkg.installPath,
      },
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
    select: { id: true, name: true, names: true, paths: true, kind: true, packageId: true },
  });
  const byPath = new Map<string, number>();
  const byName = new Map<string, { id: number; packageId: number | null }>();
  for (const cmd of commands) {
    for (const p of jsonList(cmd.paths)) byPath.set(p, cmd.id);
    for (const n of [cmd.name, ...jsonList(cmd.names)]) {
      const existing = byName.get(n);
      if (!existing || (cmd.packageId && !existing.packageId)) {
        byName.set(n, { id: cmd.id, packageId: cmd.packageId });
      }
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
    select: { id: true, name: true, names: true, paths: true, realPath: true, kind: true, packageId: true },
  });
  const byRealPath = new Map<string, number>();
  const byPath = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const cmd of commands) {
    if (cmd.realPath && !byRealPath.has(cmd.realPath)) byRealPath.set(cmd.realPath, cmd.id);
    for (const p of jsonList(cmd.paths)) if (!byPath.has(p)) byPath.set(p, cmd.id);
    if (cmd.kind === "exec") {
      for (const n of [cmd.name, ...jsonList(cmd.names)]) if (!byName.has(n)) byName.set(n, cmd.id);
    }
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
// Stage: services (systemd units → packages/commands)
// ---------------------------------------------------------------------------

async function runServicesStage(ctx: ScanCtx): Promise<StageStats> {
  const stats = EMPTY_STATS();
  const services = listSystemdServices();
  stats.found = services.length;

  const { linkIndex } = await collectPackages(ctx);
  const pkgRows = await ctx.db.package.findMany({ select: { id: true, type: true, name: true } });
  const pkgIds = new Map(pkgRows.map((p) => [`${p.type}:${p.name}`, p.id]));

  const commands = await ctx.db.command.findMany({
    select: { id: true, name: true, names: true, paths: true, realPath: true, packageId: true },
  });
  const byRealPath = new Map<string, number>();
  const byPath = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const cmd of commands) {
    if (cmd.realPath && !byRealPath.has(cmd.realPath)) byRealPath.set(cmd.realPath, cmd.id);
    for (const p of jsonList(cmd.paths)) if (!byPath.has(p)) byPath.set(p, cmd.id);
    for (const n of [cmd.name, ...jsonList(cmd.names)]) if (!byName.has(n)) byName.set(n, cmd.id);
  }

  const bar = new ProgressBar("services", services.length);
  try {
    for (const svc of services) {
      // unit file → package (dpkg lists /lib/systemd/system/*.service)
      const pkgRef = svc.unitPath ? lookupLink(linkIndex, svc.unitPath, "[]") : undefined;
      let packageId = pkgRef ? pkgIds.get(pkgRef) : undefined;

      // ExecStart binary → command
      let commandId: number | undefined;
      if (svc.execStartPath) {
        commandId = byRealPath.get(svc.execStartPath) ?? byPath.get(svc.execStartPath);
      }
      if (!commandId && svc.execStart) {
        commandId = byName.get(svc.execStartPath.split("/").pop() ?? "");
      }
      if (!packageId && commandId) {
        packageId = commands.find((c) => c.id === commandId)?.packageId ?? undefined;
      }

      await ctx.db.systemdService.upsert({
        where: { name: svc.name },
        create: {
          name: svc.name,
          description: svc.description,
          unitPath: svc.unitPath,
          activeState: svc.activeState,
          subState: svc.subState,
          enabledState: svc.enabledState,
          execStart: svc.execStart,
          execStartPath: svc.execStartPath,
          user: svc.user,
          wantedBy: svc.wantedBy,
          mainPid: svc.mainPid,
          packageId: packageId ?? null,
          commandId: commandId ?? null,
        },
        update: {
          description: svc.description,
          unitPath: svc.unitPath,
          activeState: svc.activeState,
          subState: svc.subState,
          enabledState: svc.enabledState,
          execStart: svc.execStart,
          execStartPath: svc.execStartPath,
          user: svc.user,
          wantedBy: svc.wantedBy,
          mainPid: svc.mainPid,
          packageId: packageId ?? null,
          commandId: commandId ?? null,
        },
      });
      stats.written++;
      if (packageId || commandId) stats.linked++;
      bar.tick(svc.name);
    }
    bar.done(`${stats.written} services, ${stats.linked} linked`);
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
  { id: "services", title: "services", run: runServicesStage },
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
