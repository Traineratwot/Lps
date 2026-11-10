import type { RawCommand } from "../../core/types.ts";

export type RawPackage = {
  type: "deb" | "flatpak" | "appimage" | "snap";
  name: string;
  version: string;
  architecture: string;
  status: string;
  maintainer: string;
  description: string;
  section: string;
  origin: string;
  installPath: string;
  meta: Record<string, unknown>;
};

/**
 * Distro-specific package manager integration.
 * New distros implement this interface (arch/pacman, fedora/dnf, ...).
 */
export interface DistroModule {
  id: string;
  name: string;
  detect(): Promise<boolean>;
  listPackages(): Promise<RawPackage[]>;
  /** Paths of files owned by a package (used to build the path→package index). */
  listPackageFiles(pkg: RawPackage): Promise<string[]>;
  findPackageByPath(path: string): Promise<RawPackage | null>;
  /**
   * Bulk file-path → package-name index for linking commands and desktop
   * entries to packages. In-memory only (too large for the database).
   */
  pathIndex(): Promise<Map<string, string>>;
  /** Virtual name→path mappings (update-alternatives). */
  listAlternatives?(): Promise<RawCommand[]>;
}

/** Package source that is not tied to a distro (flatpak, appimage). */
export interface PackageSource {
  id: string;
  available(): Promise<boolean>;
  list(): Promise<RawPackage[]>;
}
