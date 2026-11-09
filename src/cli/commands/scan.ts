import { createDb, ensureSchema, type Db } from "../../core/db.ts";
import type { LpsConfig } from "../../core/config.ts";
import type { RawCommand, StageStats } from "../../core/types.ts";
import type { RawPackage } from "../../modules/distro/types.ts";
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

export type ScanOptions = {
  only?: string[];
};

type StageId = "commands" | "docs" | "packages" | "desktop" | "processes";

type Stage = {
  id: StageId;
  title: string;
  run: (ctx: ScanCtx) => Promise<StageStats>;
};

export type ScanCtx = {
  config: LpsConfig;
  db: Db;
  distro: Awaited<ReturnType<typeof detectDistro>>;
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

async function collectPackages(ctx: ScanCtx): Promise<{
  packages: RawPackage[];
  /** file path → `${type}:${name}` for linking */
  linkIndex: Map<string, string>;
}> {
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

  return { packages, linkIndex };
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
// Pipeline
// ---------------------------------------------------------------------------

const STAGES: Stage[] = [
  { id: "commands", title: "commands", run: runCommandsStage },
  { id: "docs", title: "docs", run: runDocsStage },
  { id: "packages", title: "packages", run: runPackagesStage },
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

  const ctx: ScanCtx = { config, db, distro };
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
