import { createDb, ensureSchema, type Db } from "../../core/db.ts";
import type { LpsConfig } from "../../core/config.ts";
import type { RawCommand, StageStats } from "../../core/types.ts";
import { ProgressBar } from "../ui/progress.ts";
import { bold, dim, green, yellow } from "../ui/style.ts";
import { scanPathCommands } from "../../modules/commands/path-scan.ts";
import { scanAliases } from "../../modules/commands/aliases.ts";
import { scanBuiltins } from "../../modules/commands/builtins.ts";
import { detectDistro } from "../../modules/distro/detect.ts";
import { getManSummary } from "../../modules/docs/man.ts";
import { getHelpSummary, type HelpSummary } from "../../modules/docs/help.ts";

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

const EMPTY_STATS = (): StageStats => ({ found: 0, written: 0, skipped: 0, errors: 0 });

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
// Pipeline
// ---------------------------------------------------------------------------

const STAGES: Stage[] = [
  { id: "commands", title: "commands", run: runCommandsStage },
  { id: "docs", title: "docs", run: runDocsStage },
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
        .map(([id, s]) => `${id}=${s.written}`)
        .join("  "),
  );

  await db.$disconnect();
}
