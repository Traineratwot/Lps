import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RawService } from "../../core/types.ts";
import { runCommand } from "../../core/util/exec.ts";
import { execPathFromShow, parseUnitFile } from "./parse-unit.ts";

/** Unit directories of the system instance (precedence order). */
export const SYSTEM_UNIT_DIRS = [
  "/etc/systemd/system",
  "/run/systemd/system",
  "/usr/local/lib/systemd/system",
  "/usr/lib/systemd/system",
  "/lib/systemd/system",
];

type ShowProps = {
  description: string;
  fragmentPath: string;
  activeState: string;
  subState: string;
  unitFileState: string;
  execStart: string;
  user: string;
  mainPid: number | null;
};

/** Parses `systemctl show --type=service --all` output into per-unit props. */
export function parseSystemctlShow(output: string): Map<string, ShowProps> {
  const result = new Map<string, ShowProps>();
  for (const block of output.split(/\n\s*\n/)) {
    const props = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      props.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
    }
    const id = props.get("Id") ?? "";
    if (!id) continue;
    result.set(id, {
      description: props.get("Description") ?? "",
      fragmentPath: props.get("FragmentPath") ?? "",
      activeState: props.get("ActiveState") ?? "",
      subState: props.get("SubState") ?? "",
      unitFileState: props.get("UnitFileState") ?? "",
      execStart: props.get("ExecStart") ?? "",
      user: props.get("User") ?? "",
      mainPid: Number.parseInt(props.get("MainPID") ?? "", 10) || null,
    });
  }
  return result;
}

function findUnitFiles(): Map<string, string> {
  const files = new Map<string, string>(); // name → path (first dir wins)
  for (const dir of SYSTEM_UNIT_DIRS) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".service")) continue;
      const path = join(dir, entry);
      try {
        if (!statSync(path).isFile()) continue;
      } catch {
        continue;
      }
      if (!files.has(entry)) files.set(entry, path);
    }
  }
  return files;
}

function readUnit(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Collects system-level systemd services: unit files from disk merged with
 * runtime state from a single `systemctl show` call (skipped when systemd
 * is not available — states stay empty).
 */
export function listSystemdServices(): RawService[] {
  const unitFiles = findUnitFiles();

  let runtime = new Map<string, ShowProps>();
  if (Bun.which("systemctl")) {
    const res = runCommand(
      [
        "systemctl",
        "show",
        "--type=service",
        "--all",
        "--property=Id,Description,FragmentPath,ActiveState,SubState,UnitFileState,ExecStart,MainPID,User",
      ],
      { timeoutMs: 10000 },
    );
    if (res.ok && res.stdout.trim()) {
      runtime = parseSystemctlShow(res.stdout);
    }
  }

  const names = new Set<string>([...unitFiles.keys(), ...runtime.keys()]);
  const result: RawService[] = [];
  for (const name of [...names].sort()) {
    const unitPath = unitFiles.get(name) ?? runtime.get(name)?.fragmentPath ?? "";
    const parsed = unitPath ? parseUnitFile(readUnit(unitPath)) : null;
    const show = runtime.get(name);

    const execBlock = show?.execStart ?? "";
    const execStartPath = execPathFromShow(execBlock) || (parsed?.execStartPath ?? "");
    const execStart = parsed?.execStart || execBlock;

    result.push({
      name,
      description: show?.description ?? parsed?.description ?? "",
      unitPath,
      activeState: show?.activeState ?? "",
      subState: show?.subState ?? "",
      enabledState: show?.unitFileState ?? "",
      execStart,
      execStartPath,
      user: show?.user || parsed?.user || "",
      wantedBy: parsed?.wantedBy ?? "",
      mainPid: show?.mainPid ?? null,
    });
  }
  return result;
}
