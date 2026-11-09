import { existsSync, readFileSync } from "node:fs";
import { debianModule } from "./debian/index.ts";
import type { DistroModule } from "./types.ts";

export type OsRelease = {
  id: string;
  idLike: string[];
  name: string;
  version: string;
};

/** Parses /etc/os-release body (both KEY=value and KEY="value" forms). */
export function parseOsRelease(content: string): OsRelease {
  const out: OsRelease = { id: "", idLike: [], name: "", version: "" };
  const get = (key: string): string => {
    const m = content.match(new RegExp(`^${key}=(?:"([^"]*)"|([^\\n]*))`, "m"));
    return m ? (m[1] ?? m[2] ?? "").trim() : "";
  };
  out.id = get("ID");
  out.idLike = get("ID_LIKE").split(/\s+/).filter(Boolean);
  out.name = get("NAME");
  out.version = get("VERSION_ID");
  return out;
}

export function readOsRelease(): OsRelease {
  const path = "/etc/os-release";
  if (!existsSync(path)) return { id: "", idLike: [], name: "", version: "" };
  return parseOsRelease(readFileSync(path, "utf8"));
}

const MODULES: DistroModule[] = [debianModule];

export async function detectDistro(): Promise<DistroModule> {
  for (const mod of MODULES) {
    if (await mod.detect()) return mod;
  }
  throw new Error(
    `Unsupported distribution: ${readOsRelease().id || "unknown"}. Supported: debian/ubuntu`,
  );
}
