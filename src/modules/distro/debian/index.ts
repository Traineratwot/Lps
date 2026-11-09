import type { RawCommand } from "../../../core/types.ts";
import type { DistroModule, RawPackage } from "../types.ts";
import { readOsRelease } from "../detect.ts";
import { scanAlternatives } from "./alternatives.ts";
import { dpkgSearchFile, loadDpkgIndex, type DpkgIndex } from "./dpkg.ts";

let cachedIndex: DpkgIndex | null = null;
function index(): DpkgIndex {
  if (!cachedIndex) cachedIndex = loadDpkgIndex();
  return cachedIndex;
}

export const debianModule: DistroModule = {
  id: "debian",
  name: "Debian/Ubuntu (dpkg)",

  async detect(): Promise<boolean> {
    const os = readOsRelease();
    return os.id === "debian" || os.id === "ubuntu" || os.idLike.includes("debian");
  },

  async listPackages(): Promise<RawPackage[]> {
    return [...index().byName.values()];
  },

  async listPackageFiles(pkg: RawPackage): Promise<string[]> {
    const listPath = `/var/lib/dpkg/info/${pkg.name}.list`;
    try {
      const content = await Bun.file(listPath).text();
      return content.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  },

  async findPackageByPath(path: string): Promise<RawPackage | null> {
    const name = index().byPath.get(path) ?? dpkgSearchFile(path);
    if (!name) return null;
    return index().byName.get(name) ?? null;
  },

  async pathIndex(): Promise<Map<string, string>> {
    return index().byPath;
  },

  async listAlternatives(): Promise<RawCommand[]> {
    return scanAlternatives();
  },
};

/** Drops the memoized dpkg index (used between scans/tests). */
export function resetDpkgIndex(): void {
  cachedIndex = null;
}
