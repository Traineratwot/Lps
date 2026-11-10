import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, ensureSchema, type Db } from "../../core/db.ts";
import { resolveConfig, type LpsConfig } from "../../core/config.ts";
import { createWebServer, type WebServer } from "./server.ts";

let dir: string;
let config: LpsConfig;
let db: Db;
let server: WebServer;

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

type AnyCard = Record<string, unknown> & { name: string };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lps-web-test-"));
  const dataDir = join(dir, "data");
  mkdirSync(join(dataDir, "icons"), { recursive: true });
  config = resolveConfig({ dbPath: join(dir, "test.db"), dataDir, users: ["root"] });

  await ensureSchema(config.dbPath);
  db = createDb(config.dbPath);

  // fixtures
  const pkg = await db.package.create({
    data: { type: "deb", name: "htop", version: "3.0", description: "process viewer", section: "utils" },
  });
  const cmd = await db.command.create({
    data: {
      hash: "hash-htop",
      name: "htop",
      kind: "exec",
      realPath: "/usr/bin/htop",
      paths: JSON.stringify(["/usr/bin/htop"]),
      names: JSON.stringify(["htop"]),
      aliases: "[]",
      source: "path",
      packageId: pkg.id,
    },
  });
  await db.commandDoc.create({
    data: { commandId: cmd.id, summary: "interactive process viewer", source: "man", manPath: "/x/htop.1.gz" },
  });
  // icon inside iconsDir
  const iconPath = join(dataDir, "icons", "aa.png");
  writeFileSync(iconPath, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  await db.desktopEntry.create({
    data: {
      filePath: "/usr/share/applications/htop.desktop",
      name: "Htop",
      comment: "process viewer",
      exec: "htop %F",
      categories: "System;",
      iconPath,
      packageId: pkg.id,
      commandId: cmd.id,
    },
  });
  // orphan package (no desktop entries)
  await db.package.create({
    data: { type: "appimage", name: "SoloApp", version: "1.2", description: "standalone", section: "" },
  });
  // desktop entry with iconPath escaping iconsDir (path-containment probe)
  await db.desktopEntry.create({
    data: {
      filePath: "/tmp/evil.desktop",
      name: "Evil",
      comment: "",
      exec: "evil",
      iconPath: "/etc/passwd",
    },
  });
  // process for running counts
  await db.process.create({
    data: {
      pid: 4242,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      cmdline: "htop",
      exePath: "/usr/bin/htop",
      user: "root",
      packageId: pkg.id,
      commandId: cmd.id,
    },
  });

  // systemd service linked to package + command
  await db.systemdService.create({
    data: {
      name: "htop.service",
      description: "Test service",
      unitPath: "/lib/systemd/system/htop.service",
      activeState: "active",
      subState: "running",
      enabledState: "enabled",
      execStart: "/usr/bin/htop --daemon",
      execStartPath: "/usr/bin/htop",
      mainPid: 4242,
      packageId: pkg.id,
      commandId: cmd.id,
    },
  });

  // web root fixture
  const webRoot = join(dir, "web");
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, "index.html"), "<html><body>lps-app</body></html>");
  writeFileSync(join(webRoot, "app.js"), "console.log(1)");
  writeFileSync(join(webRoot, "app.css"), "body{}");

  server = await createWebServer(config, { db, port: 0, webRoot, readonly: true });
});

afterAll(() => {
  server.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("web server", () => {
  test("health", async () => {
    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.readonly).toBe(true);
    expect(body.dbPath).toBe(config.dbPath);
  });

  test("stats", async () => {
    const body = await json(await fetch(`${server.url}/api/stats`));
    expect(body.packages).toBe(2);
    expect(body.desktopEntries).toBe(2);
    expect(body.processes).toBe(1);
  });

  test("programs list merges desktop + orphan package cards", async () => {
    const body = await json(await fetch(`${server.url}/api/programs?pageSize=10`));
    expect(body.total).toBe(3);
    const items = body.items as AnyCard[];
    const byName = Object.fromEntries(items.map((c) => [c.name, c]));
    expect((byName["Htop"] as AnyCard).id).toBe("de:1");
    expect((byName["Htop"] as AnyCard).iconUrl).toBe("/api/icons/1");
    expect((byName["Htop"] as AnyCard).runningCount).toBe(1);
    expect(((byName["Htop"] as AnyCard).commands as Array<{ summary: string }>)[0]!.summary).toBe(
      "interactive process viewer",
    );
    expect(String((byName["SoloApp"] as AnyCard).id)).toMatch(/^pkg:/);
    expect((byName["SoloApp"] as AnyCard).iconUrl).toBeNull();
    expect((byName["Evil"] as AnyCard).id).toBe("de:2");
  });

  test("program search and filters", async () => {
    const search = await json(await fetch(`${server.url}/api/programs?q=solo`));
    expect(search.total).toBe(1);
    expect((search.items as AnyCard[])[0]!.name).toBe("SoloApp");

    const withIcon = await json(await fetch(`${server.url}/api/programs?hasIcon=true`));
    expect(withIcon.total).toBe(1);

    const running = await json(await fetch(`${server.url}/api/programs?running=true`));
    expect(running.total).toBe(1);
    expect((running.items as AnyCard[])[0]!.name).toBe("Htop");
  });

  test("program detail", async () => {
    const body = await json(await fetch(`${server.url}/api/programs/de:1`));
    expect(body.name).toBe("Htop");
    expect((body.package as Record<string, unknown>).name).toBe("htop");
    expect((body.commandsFull as Array<{ manPath: string }>)[0]!.manPath).toBe("/x/htop.1.gz");
    expect((body.processes as Array<{ pid: number }>)[0]!.pid).toBe(4242);
    expect((body.desktop as Record<string, unknown>).exec).toBe("htop %F");

    const missing = await fetch(`${server.url}/api/programs/de:999`);
    expect(missing.status).toBe(404);
  });

  test("commands and processes lists", async () => {
    const cmds = await json(await fetch(`${server.url}/api/commands?q=htop`));
    expect(cmds.total).toBe(1);
    expect((cmds.items as AnyCard[])[0]!.packageName).toBe("htop");

    const procs = await json(await fetch(`${server.url}/api/processes`));
    expect(procs.total).toBe(1);
    expect((procs.items as AnyCard[])[0]!.commandName).toBe("htop");

    const cmdId = (cmds.items as AnyCard[])[0]!.id as number;
    const detail = await json(await fetch(`${server.url}/api/commands/${cmdId}`));
    expect((detail.doc as Record<string, unknown>).summary).toBe("interactive process viewer");
  });

  test("services list and detail link to package and command", async () => {
    const list = await json(await fetch(`${server.url}/api/services?q=htop`));
    expect(list.total).toBe(1);
    const row = (list.items as AnyCard[])[0]!;
    expect(row.name).toBe("htop.service");
    expect(row.activeState).toBe("active");
    expect(row.packageName).toBe("htop");
    expect(row.commandName).toBe("htop");

    const detail = await json(await fetch(`${server.url}/api/services/${row.id}`));
    expect(detail.unitPath).toBe("/lib/systemd/system/htop.service");
    expect(detail.execStartPath).toBe("/usr/bin/htop");
    expect((detail.package as Record<string, unknown>).name).toBe("htop");
    expect((detail.command as Record<string, unknown>).name).toBe("htop");

    const missing = await fetch(`${server.url}/api/services/9999`);
    expect(missing.status).toBe(404);
  });

  test("icons: served inside iconsDir, rejected outside", async () => {
    const ok = await fetch(`${server.url}/api/icons/1`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");

    // de:2 has iconPath=/etc/passwd — must not be served
    const evil = await fetch(`${server.url}/api/icons/2`);
    expect(evil.status).toBe(404);

    const missing = await fetch(`${server.url}/api/icons/999`);
    expect(missing.status).toBe(404);
  });

  test("static assets and SPA fallback", async () => {
    const index = await fetch(`${server.url}/`);
    expect(await index.text()).toContain("lps-app");

    const js = await fetch(`${server.url}/app.js`);
    expect(js.headers.get("content-type")).toContain("javascript");

    // extension-less route → SPA shell
    const spa = await fetch(`${server.url}/commands`);
    expect(await spa.text()).toContain("lps-app");

    // file-like path missing → 404
    const missing = await fetch(`${server.url}/nope.js`);
    expect(missing.status).toBe(404);

    // traversal attempt
    const traversal = await fetch(`${server.url}/..%2F..%2Fetc%2Fpasswd`);
    expect(traversal.status).toBe(404);
  });

  test("unknown api route", async () => {
    const res = await fetch(`${server.url}/api/nope`);
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.error).toBeTruthy();
  });
});
