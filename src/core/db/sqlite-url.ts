import { resolve } from "node:path";

/**
 * SQLite URL/path helpers shared by the runtime adapter and prisma.config.ts.
 * No bun:sqlite / import.meta.dir here — the Prisma CLI loads prisma.config.ts
 * under Node as well as Bun; node:path is fine for both.
 */

/**
 * Normalizes a SQLite URL to a filesystem path.
 * Accepts plain paths and both file: forms Prisma tools produce —
 * `file:./dev.db` (classic) and `file://./dev.db` (Prisma 7 / Studio).
 * `fileURLToPath` is not used: it resolves `file:./x` to `/x` and rejects
 * the `file://./x` form outright.
 */
export function sqlitePath(url: string): string {
  if (url === ":memory:") return url;
  if (!url.startsWith("file:")) return url;
  let rest = url.slice("file:".length);
  if (rest.startsWith("//")) rest = rest.slice(2);
  if (rest.startsWith("localhost/")) rest = rest.slice("localhost".length);
  return rest || url;
}

/**
 * Normalizes any SQLite URL/path to the canonical absolute `file:///path`.
 *
 * Prisma tools disagree on SQLite URL shapes (studio#1578):
 * - `prisma studio` rejects `file:./dev.db` — "not supported for the file: protocol";
 * - `prisma migrate` fails on relative `file://./dev.db` — "unable to open database file: //./dev.db";
 * - an absolute `file:///path/to.db` works for both.
 */
export function normalizeSqliteUrl(input: string, cwd: string): string {
  if (input === ":memory:") return input;
  const path = resolve(cwd, sqlitePath(input));
  return `file://${path}`;
}
