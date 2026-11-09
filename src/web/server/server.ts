import { join } from "node:path";
import type { LpsConfig } from "../../core/config.ts";
import { openDb, type Db } from "../../core/db.ts";
import { handleApi, type ApiCtx } from "./api/handlers.ts";
import { matchApi } from "./api/router.ts";
import { createAssetSource, type AssetSource } from "./static.ts";

export type WebServerOptions = {
  host?: string;
  port: number;
  /** Frontend bundle directory; defaults to `<cwd>/dist/web`. */
  webRoot?: string;
  /** Reuse an already opened DB (tests); otherwise opened from config. */
  db?: Db;
  readonly?: boolean;
};

export type WebServer = {
  url: string;
  port: number;
  db: Db;
  stop: () => void;
};

/** Directory of the built frontend: embedded `web/` sibling, or ./dist/web in dev. */
export function defaultWebRoot(): string {
  return Bun.isStandaloneExecutable ? join(import.meta.dir, "web") : join(process.cwd(), "dist", "web");
}

export async function createWebServer(config: LpsConfig, options: WebServerOptions): Promise<WebServer> {
  const db = options.db ?? (await openDb(config));
  const readonly = options.readonly ?? false;
  const assets: AssetSource = createAssetSource(options.webRoot ?? defaultWebRoot());
  const ctx: ApiCtx = { db, config, readonly };

  const server = Bun.serve({
    hostname: options.host ?? "127.0.0.1",
    port: options.port,
    idleTimeout: 30,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      const route = matchApi(req.method, pathname, url.searchParams);
      if (route === "unknown") {
        return Response.json({ error: "unknown api route" }, { status: 404 });
      }
      if (route) {
        try {
          return await handleApi(ctx, route);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 500 });
        }
      }

      const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
      const asset = assets.get(rel);
      if (asset) return asset;

      // SPA fallback: routes without a file extension render the app shell.
      const lastSegment = rel.split("/").pop() ?? "";
      if (!lastSegment.includes(".")) {
        const index = assets.get("index.html");
        if (index) return index;
      }
      return new Response("Not found", { status: 404 });
    },
  });

  return {
    url: `http://${server.hostname}:${server.port}`,
    port: server.port ?? options.port,
    db,
    stop: () => {
      void db.$disconnect();
      server.stop(true);
    },
  };
}
