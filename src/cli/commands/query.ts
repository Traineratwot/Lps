import { accessSync, constants, existsSync, writeFileSync } from "node:fs";
import type { LpsConfig } from "../../core/config.ts";
import { createDb, ensureSchema, type Db } from "../../core/db.ts";
import { renderTable } from "../ui/table.ts";
import { bold, cyan, dim, green, red } from "../ui/style.ts";
import { flagString, type FlagValue } from "../args.ts";

type Flags = Record<string, FlagValue>;

function limitOf(flags: Flags): number {
  const v = Number.parseInt(flagString(flags, "limit") ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 50;
}

function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens the DB for read queries. Works without root on a root-owned DB:
 * falls back to read-only mode, so `sudo lps scan` + `lps list` as a user
 * is the normal workflow.
 */
async function openDb(config: LpsConfig): Promise<Db> {
  const exists = existsSync(config.dbPath);
  if (exists && !isWritable(config.dbPath)) {
    return createDb(config.dbPath, { readonly: true });
  }
  if (!exists && !isWritable(config.dataDir)) {
    console.error(red(`Database not found: ${config.dbPath}`));
    console.error(`Run ${bold("sudo lps scan")} first, or pass ${bold("--db <path>")}.`);
    process.exit(1);
  }
  await ensureSchema(config.dbPath);
  return createDb(config.dbPath);
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export async function runList(config: LpsConfig, entity: string | undefined, flags: Flags): Promise<void> {
  const db = await openDb(config);
  try {
    switch (entity) {
      case "commands": await listCommands(db, flags); break;
      case "packages": await listPackages(db, flags); break;
      case "desktop": await listDesktop(db, flags); break;
      case "processes": await listProcesses(db, flags); break;
      default:
        console.error(red(`Unknown entity: ${entity ?? "(none)"}. Use commands|packages|desktop|processes`));
        process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
  }
}

async function listCommands(db: Db, flags: Flags): Promise<void> {
  const search = flagString(flags, "search");
  const rows = await db.command.findMany({
    where: {
      ...(search ? { name: { contains: search } } : {}),
      ...(flags.orphan ? { packageId: null } : {}),
    },
    include: { doc: true, package: true },
    orderBy: { name: "asc" },
    take: limitOf(flags),
  });
  console.log(renderTable(
    ["NAME", "KIND", "PATH", "SUMMARY", "PACKAGE"],
    rows.map((r) => [
      r.name,
      r.kind,
      r.path || "-",
      (r.doc?.summary ?? "").slice(0, 50),
      r.package ? `${r.package.name} (${r.package.type})` : "-",
    ]),
  ));
  console.log(dim(`showing ${rows.length} rows`));
}

async function listPackages(db: Db, flags: Flags): Promise<void> {
  const search = flagString(flags, "search");
  const type = flagString(flags, "type");
  const rows = await db.package.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(search ? { name: { contains: search } } : {}),
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    take: limitOf(flags),
  });
  console.log(renderTable(
    ["TYPE", "NAME", "VERSION", "DESCRIPTION"],
    rows.map((r) => [r.type, r.name, r.version, r.description.slice(0, 55)]),
  ));
  console.log(dim(`showing ${rows.length} rows`));
}

async function listDesktop(db: Db, flags: Flags): Promise<void> {
  const search = flagString(flags, "search");
  const rows = await db.desktopEntry.findMany({
    where: search ? { name: { contains: search } } : {},
    include: { package: true },
    orderBy: { name: "asc" },
    take: limitOf(flags),
  });
  console.log(renderTable(
    ["NAME", "EXEC", "ICON", "PACKAGE", "HIDDEN"],
    rows.map((r) => [
      r.name,
      r.exec.slice(0, 40),
      r.iconPath ? "yes" : (r.iconName || "-"),
      r.package?.name ?? "-",
      r.noDisplay || r.hidden ? "yes" : "",
    ]),
  ));
  console.log(dim(`showing ${rows.length} rows`));
}

async function listProcesses(db: Db, flags: Flags): Promise<void> {
  const rows = await db.process.findMany({
    include: {
      snapshots: { orderBy: { observedAt: "desc" }, take: 1 },
      command: true,
      package: true,
    },
    orderBy: [{ pid: "asc" }],
    take: limitOf(flags),
  });
  console.log(renderTable(
    ["PID", "USER", "CMDLINE", "STATE", "CPU%", "RSS(KB)", "UPTIME(s)", "PACKAGE"],
    rows.map((r) => {
      const snap = r.snapshots[0];
      return [
        String(r.pid),
        r.user || "?",
        (r.cmdline || r.exePath || "(kernel)").slice(0, 38),
        snap?.state ?? "?",
        snap ? String(snap.cpuPercent ?? 0) : "-",
        snap?.rssKb != null ? String(snap.rssKb) : "-",
        snap ? String(snap.uptimeSec) : "-",
        r.package?.name ?? r.command?.name ?? "-",
      ];
    }),
  ));
  console.log(dim(`showing ${rows.length} rows`));
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

export async function runShow(config: LpsConfig, target: string | undefined, _flags: Flags): Promise<void> {
  if (!target) {
    console.error(red("usage: lps show <name|pkg:<name>|pid>"));
    process.exitCode = 1;
    return;
  }
  const db = await openDb(config);
  try {
    if (/^\d+$/.test(target)) {
      await showProcess(db, Number(target));
    } else if (target.startsWith("pkg:")) {
      await showPackage(db, target.slice(4));
    } else {
      await showCommand(db, target);
    }
  } finally {
    await db.$disconnect();
  }
}

async function showCommand(db: Db, name: string): Promise<void> {
  const rows = await db.command.findMany({
    where: { name },
    include: { doc: true, package: true, desktopEntries: true },
    orderBy: [{ kind: "asc" }, { path: "asc" }],
  });
  if (rows.length === 0) {
    console.error(red(`command not found: ${name}`));
    process.exitCode = 1;
    return;
  }
  for (const cmd of rows) {
    console.log(`${bold(cmd.name)} ${dim(`(${cmd.kind})`)}`);
    if (cmd.path) console.log(`  ${dim("path:")}      ${cmd.path}`);
    if (cmd.realPath && cmd.realPath !== cmd.path) console.log(`  ${dim("realPath:")}  ${cmd.realPath}`);
    if (cmd.aliasOf) console.log(`  ${dim("aliasOf:")}   ${cmd.aliasOf}`);
    if (cmd.doc?.summary) console.log(`  ${dim("summary:")}   ${cmd.doc.summary}`);
    if (cmd.doc?.manPath) console.log(`  ${dim("man:")}       ${cmd.doc.manPath} (section ${cmd.doc.manSection})`);
    if (cmd.doc?.source) console.log(`  ${dim("docSource:")} ${cmd.doc.source}${cmd.doc.helpFlag ? ` (${cmd.doc.helpFlag})` : ""}`);
    if (cmd.package) {
      console.log(`  ${dim("package:")}   ${green(cmd.package.name)} ${dim(`${cmd.package.type} ${cmd.package.version}`)}`);
    }
    for (const de of cmd.desktopEntries) {
      console.log(`  ${dim("desktop:")}   ${de.name} ${dim(`(${de.filePath})`)}`);
    }
    const procs = await db.process.findMany({
      where: { commandId: cmd.id },
      include: { snapshots: { orderBy: { observedAt: "desc" }, take: 1 } },
    });
    if (procs.length > 0) {
      console.log(`  ${dim("processes:")}`);
      for (const p of procs) {
        const s = p.snapshots[0];
        console.log(`    ${cyan(String(p.pid))} ${dim(`started ${p.startedAt.toISOString()} uptime ${s?.uptimeSec ?? "?"}s cpu ${s?.cpuPercent ?? "?"}%`)}`);
      }
    }
    console.log("");
  }
}

async function showPackage(db: Db, name: string): Promise<void> {
  const rows = await db.package.findMany({
    where: { name },
    include: { commands: true, desktopEntries: true, processes: true },
  });
  if (rows.length === 0) {
    console.error(red(`package not found: ${name}`));
    process.exitCode = 1;
    return;
  }
  for (const pkg of rows) {
    console.log(`${bold(pkg.name)} ${dim(`(${pkg.type} ${pkg.version})`)}`);
    if (pkg.description) console.log(`  ${dim("description:")} ${pkg.description}`);
    if (pkg.maintainer) console.log(`  ${dim("maintainer:")}  ${pkg.maintainer}`);
    if (pkg.section) console.log(`  ${dim("section:")}     ${pkg.section}`);
    if (pkg.origin) console.log(`  ${dim("origin:")}      ${pkg.origin}`);
    if (pkg.installPath) console.log(`  ${dim("installPath:")} ${pkg.installPath}`);
    if (pkg.commands.length) {
      console.log(`  ${dim("commands:")}    ${pkg.commands.map((c) => c.name).join(", ")}`);
    }
    if (pkg.desktopEntries.length) {
      console.log(`  ${dim("desktop:")}     ${pkg.desktopEntries.map((d) => d.name).join(", ")}`);
    }
    if (pkg.processes.length) {
      console.log(`  ${dim("processes:")}   ${pkg.processes.map((p) => p.pid).join(", ")}`);
    }
    console.log("");
  }
}

async function showProcess(db: Db, pid: number): Promise<void> {
  const rows = await db.process.findMany({
    where: { pid },
    include: {
      snapshots: { orderBy: { observedAt: "desc" } },
      command: true,
      package: true,
    },
  });
  if (rows.length === 0) {
    console.error(red(`process not found: pid=${pid}`));
    process.exitCode = 1;
    return;
  }
  for (const p of rows) {
    console.log(`${bold(String(p.pid))} ${dim(p.startedAt.toISOString())}`);
    console.log(`  ${dim("cmdline:")}  ${p.cmdline || "(kernel thread)"}`);
    if (p.exePath) console.log(`  ${dim("exe:")}      ${p.exePath}`);
    console.log(`  ${dim("user:")}     ${p.user || "?"} ${dim(`uid=${p.uid ?? "?"}`)}`);
    if (p.command) console.log(`  ${dim("command:")}  ${p.command.name} ${dim(`(${p.command.path})`)}`);
    if (p.package) console.log(`  ${dim("package:")}  ${green(p.package.name)} ${dim(p.package.type)}`);
    console.log(`  ${dim("snapshots:")}`);
    for (const s of p.snapshots.slice(0, 10)) {
      console.log(
        `    ${s.observedAt.toISOString()}  ${dim(`uptime ${s.uptimeSec}s cpu ${s.cpuPercent ?? "?"}% rss ${s.rssKb ?? "?"}kB state ${s.state}`)}`,
      );
    }
    console.log("");
  }
}

// ---------------------------------------------------------------------------
// logs
// ---------------------------------------------------------------------------

export async function runLogs(config: LpsConfig, target: string | undefined, flags: Flags): Promise<void> {
  if (!target) {
    console.error(red("usage: lps logs <pid|name>"));
    process.exitCode = 1;
    return;
  }
  const db = await openDb(config);
  try {
    const where = /^\d+$/.test(target) ? { pid: Number(target) } : { command: { name: target } };
    const rows = await db.process.findMany({
      where,
      include: {
        snapshots: { orderBy: { observedAt: "desc" }, take: limitOf(flags) },
        command: true,
      },
    });
    if (rows.length === 0) {
      console.error(red(`no snapshots for: ${target}`));
      process.exitCode = 1;
      return;
    }
    const out: string[][] = [];
    for (const p of rows) {
      for (const s of p.snapshots) {
        out.push([
          String(p.pid),
          p.command?.name ?? (p.cmdline.slice(0, 25) || "(kernel)"),
          s.observedAt.toISOString(),
          `${s.uptimeSec}s`,
          `${s.cpuPercent ?? "-"}%`,
          s.rssKb != null ? `${s.rssKb}kB` : "-",
          s.state,
        ]);
      }
    }
    console.log(renderTable(["PID", "NAME", "OBSERVED", "UPTIME", "CPU", "RSS", "STATE"], out));
    console.log(dim(`showing ${out.length} snapshot rows`));
  } finally {
    await db.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

export async function runExport(config: LpsConfig, flags: Flags): Promise<void> {
  const db = await openDb(config);
  try {
    const format = flagString(flags, "format") ?? "json";
    const data = {
      exportedAt: new Date().toISOString(),
      commands: await db.command.findMany({ include: { doc: true } }),
      packages: await db.package.findMany(),
      desktopEntries: await db.desktopEntry.findMany(),
      processes: await db.process.findMany({ include: { snapshots: true } }),
    };

    let text: string;
    if (format === "csv") {
      // commands-only CSV is the useful flat view
      const header = ["name", "kind", "path", "realPath", "summary", "package"];
      const lines = [header.join(",")];
      for (const c of data.commands) {
        lines.push([
          c.name, c.kind, c.path, c.realPath,
          JSON.stringify(c.doc?.summary ?? ""),
          c.packageId != null ? String(c.packageId) : "",
        ].join(","));
      }
      text = lines.join("\n");
    } else {
      text = JSON.stringify(data, null, 2);
    }

    const out = flagString(flags, "out");
    if (out) {
      writeFileSync(out, text);
      console.log(`${green("✓")} exported to ${cyan(out)}`);
    } else {
      console.log(text);
    }
  } finally {
    await db.$disconnect();
  }
}
