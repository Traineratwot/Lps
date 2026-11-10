import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";

export type AssetSource = {
  /** Returns a response for a static asset, or null when not found. */
  get(relPath: string): Response | null;
};

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  png: "image/png",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  eot: "application/vnd.ms-fontobject",
  map: "application/json",
};

function mimeOf(path: string): string {
  return MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

function cacheFor(_relPath: string): string {
  // Local tool: never cache app assets, so a rebuilt binary is visible on a
  // plain refresh (icons are content-hashed and cached separately by the API).
  return "no-cache";
}

function safeRelative(relPath: string): string | null {
  const cleaned = normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  if (cleaned.startsWith("..") || cleaned.includes(`..${sep}`) || cleaned.startsWith("/")) return null;
  return cleaned;
}

/**
 * Serves the frontend bundle. In a compiled binary the files come from
 * `Bun.embeddedFiles` (embedded via `--asset ./dist/web`); during development
 * they are read from `<webRoot>` on disk.
 */
export function createAssetSource(webRoot: string): AssetSource {
  if (Bun.isStandaloneExecutable) {
    // Names look like "web/index.html" (basename of --asset + tree).
    // Bun's embedded blobs carry a `name`; plain lib.dom Blob typing lacks it.
    const embedded = new Map<string, Blob>();
    for (const blob of Bun.embeddedFiles as ReadonlyArray<Blob & { name?: string }>) {
      const rawName = blob.name ?? "";
      const name = rawName.startsWith("web/") ? rawName.slice(4) : rawName;
      if (name) embedded.set(name, blob);
    }
    return {
      get(relPath) {
        const blob = embedded.get(relPath);
        return blob ? new Response(blob, { headers: { "Content-Type": mimeOf(relPath), "Cache-Control": cacheFor(relPath) } }) : null;
      },
    };
  }

  const root = resolve(webRoot);
  return {
    get(relPath) {
      const safe = safeRelative(relPath);
      if (!safe) return null;
      const full = resolve(join(root, safe));
      if (full !== root && !full.startsWith(root + sep)) return null;
      if (!existsSync(full) || !statSync(full).isFile()) return null;
      return new Response(readFileSync(full), {
        headers: { "Content-Type": mimeOf(full), "Cache-Control": cacheFor(safe) },
      });
    },
  };
}
