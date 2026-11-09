export type ExecResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/**
 * Runs a command with a hard timeout, closed stdin and bounded output.
 * Never throws — failures come back as ok:false.
 */
export function runCommand(
  cmd: string[],
  options: { timeoutMs?: number; env?: Record<string, string>; cwd?: string } = {},
): ExecResult {
  const timeoutMs = options.timeoutMs ?? 3000;
  try {
    const proc = Bun.spawnSync(cmd, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      cwd: options.cwd ?? "/tmp",
      env: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        ...options.env,
      },
    });
    const stdout = proc.stdout?.toString() ?? "";
    const stderr = proc.stderr?.toString() ?? "";
    return {
      ok: proc.exitCode === 0,
      code: proc.exitCode,
      // keep memory bounded
      stdout: stdout.length > 256 * 1024 ? stdout.slice(0, 256 * 1024) : stdout,
      stderr: stderr.length > 64 * 1024 ? stderr.slice(0, 64 * 1024) : stderr,
      timedOut: proc.exitCode === null || proc.signalCode === "SIGTERM" || proc.signalCode === "SIGKILL",
    };
  } catch (error) {
    return {
      ok: false,
      code: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      timedOut: false,
    };
  }
}

export function which(binary: string): string | null {
  return Bun.which(binary) ?? null;
}
