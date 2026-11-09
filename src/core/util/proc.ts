import { readFileSync, readdirSync, readlinkSync, existsSync } from "node:fs";

export type ProcStat = {
  pid: number;
  comm: string;
  state: string;
  ppid: number;
  utime: number;
  stime: number;
  numThreads: number;
  /** Clock ticks since boot (field 22). */
  starttime: number;
};

export type ProcInfo = ProcStat & {
  cmdline: string;
  exePath: string;
  uid: number | null;
  rssKb: number | null;
  isKernel: boolean;
};

let clkTck: number | null = null;

/** System clock ticks per second (getconf CLK_TCK, usually 100). */
export function clockTicks(): number {
  if (clkTck !== null) return clkTck;
  try {
    const res = Bun.spawnSync(["getconf", "CLK_TCK"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const v = Number.parseInt(res.stdout?.toString() ?? "", 10);
    clkTck = Number.isFinite(v) && v > 0 ? v : 100;
  } catch {
    clkTck = 100;
  }
  return clkTck;
}

/** Boot time in epoch seconds from /proc/stat `btime`. */
export function bootTime(): number {
  const content = readFileSync("/proc/stat", "utf8");
  const m = content.match(/^btime (\d+)$/m);
  return m ? Number(m[1]) : Math.floor(Date.now() / 1000);
}

/**
 * Parses /proc/<pid>/stat. comm may contain spaces and parentheses,
 * so we split at the LAST ") ".
 */
export function parseStat(content: string): ProcStat | null {
  const open = content.indexOf("(");
  const close = content.lastIndexOf(") ");
  if (open < 0 || close < 0) return null;
  const pid = Number.parseInt(content.slice(0, open).trim(), 10);
  const comm = content.slice(open + 1, close);
  const rest = content.slice(close + 2).split(" ");
  // rest[0] = field 3 (state); field N ↔ rest[N-3]
  const num = (i: number): number => {
    const v = Number.parseInt(rest[i] ?? "", 10);
    return Number.isFinite(v) ? v : 0;
  };
  return {
    pid,
    comm,
    state: rest[0] ?? "?",
    ppid: num(1),
    utime: num(11),
    stime: num(12),
    numThreads: num(17),
    starttime: num(19),
  };
}

function readProcFile(pid: number, file: string): string {
  try {
    return readFileSync(`/proc/${pid}/${file}`, "utf8");
  } catch {
    return "";
  }
}

/** Full info for one process; null when it vanished mid-read. */
export function readProcess(pid: number): ProcInfo | null {
  const statRaw = readProcFile(pid, "stat");
  if (!statRaw) return null;
  const stat = parseStat(statRaw);
  if (!stat) return null;

  const cmdline = readProcFile(pid, "cmdline").replace(/\0/g, " ").trim();
  let exePath = "";
  try {
    exePath = readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, "");
  } catch {
    exePath = "";
  }

  const status = readProcFile(pid, "status");
  let uid: number | null = null;
  let rssKb: number | null = null;
  for (const line of status.split(/\r?\n/)) {
    if (line.startsWith("Uid:")) {
      uid = Number.parseInt(line.split(/\s+/)[1] ?? "", 10) || 0;
    } else if (line.startsWith("VmRSS:")) {
      rssKb = Number.parseInt(line.split(/\s+/)[1] ?? "", 10) || null;
    }
  }

  return {
    ...stat,
    cmdline,
    exePath,
    uid,
    rssKb,
    isKernel: !exePath && !cmdline,
  };
}

/** All currently running processes. */
export function listProcesses(): ProcInfo[] {
  const result: ProcInfo[] = [];
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const info = readProcess(Number(entry));
    if (info) result.push(info);
  }
  return result;
}

/** Instantaneous CPU% (average over process lifetime) and uptime. */
export function computeMetrics(
  proc: ProcStat,
  nowSec: number,
  btimeSec: number,
): { uptimeSec: number; cpuPercent: number } {
  const tck = clockTicks();
  const startedAtSec = btimeSec + proc.starttime / tck;
  const uptimeSec = Math.max(0, Math.round(nowSec - startedAtSec));
  const cpuSeconds = (proc.utime + proc.stime) / tck;
  const cpuPercent = uptimeSec > 0 ? Math.round((cpuSeconds / uptimeSec) * 10000) / 100 : 0;
  return { uptimeSec, cpuPercent };
}

/** Converts boot-relative starttime to an ISO timestamp. */
export function startedAtIso(proc: ProcStat, btimeSec: number): string {
  const tck = clockTicks();
  return new Date((btimeSec + proc.starttime / tck) * 1000).toISOString();
}

export function procExists(pid: number): boolean {
  return existsSync(`/proc/${pid}`);
}
