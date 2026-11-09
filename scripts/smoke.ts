import { createDb, ensureSchema } from "../src/core/db.ts";

const dbPath = process.env.SMOKE_DB ?? "/tmp/lps-smoke.db";
await ensureSchema(dbPath);
const db = createDb(dbPath);

await db.command.upsert({
  where: { name_path: { name: "git", path: "/usr/bin/git" } },
  create: { name: "git", kind: "exec", path: "/usr/bin/git", realPath: "/usr/bin/git", source: "path" },
  update: { realPath: "/usr/bin/git" },
});

const cmds = await db.command.findMany();
console.log("commands:", JSON.stringify(cmds, null, 2));

const pkg = await db.package.create({
  data: { type: "deb", name: "git", version: "1:2.43.0", description: "VCS" },
});
await db.command.update({ where: { id: cmds[0]!.id }, data: { packageId: pkg.id } });

const withPkg = await db.command.findFirst({ where: { name: "git" }, include: { package: true } });
console.log("linked:", withPkg?.name, "->", withPkg?.package?.name, withPkg?.package?.version);

const count = await db.package.count();
console.log("package count:", count);

await db.commandDoc.create({
  data: {
    commandId: cmds[0]!.id,
    summary: "Git is a fast VCS",
    manPath: "/usr/share/man/man1/git.1.gz",
    manSection: "1",
    source: "man",
  },
});
const doc = await db.commandDoc.findFirst({ where: { command: { name: "git" } } });
console.log("doc:", doc?.summary, doc?.manPath);

await db.$disconnect();
console.log("SMOKE OK");
