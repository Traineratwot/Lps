import { describe, expect, test } from "bun:test";
import { computeMetrics, parseStat, startedAtIso } from "./proc.ts";

// field 22 (starttime) = 12345 ticks; utime=200, stime=100 → 3s cpu at 100Hz
const STAT = "42 (my proc (x)) S 1 2 3 4 -1 0 0 0 0 0 200 100 0 0 20 0 2 0 12345 0 0 0";

describe("parseStat", () => {
  test("parses pid, comm with parens/spaces, state and counters", () => {
    const s = parseStat(STAT);
    expect(s).not.toBeNull();
    expect(s!.pid).toBe(42);
    expect(s!.comm).toBe("my proc (x)");
    expect(s!.state).toBe("S");
    expect(s!.ppid).toBe(1);
    expect(s!.utime).toBe(200);
    expect(s!.stime).toBe(100);
    expect(s!.numThreads).toBe(2);
    expect(s!.starttime).toBe(12345);
  });

  test("returns null on garbage", () => {
    expect(parseStat("no parens here")).toBeNull();
  });
});

describe("computeMetrics", () => {
  const btime = 1_000_000;
  const now = btime + 600; // 600s after boot

  test("uptime follows starttime", () => {
    const s = parseStat(STAT)!;
    const { uptimeSec } = computeMetrics(s, now, btime);
    // started at btime + 12345/100 = btime + 123.45s → uptime ≈ 476.55s
    expect(uptimeSec).toBe(Math.round(600 - 123.45));
  });

  test("cpu percent is lifetime average", () => {
    const s = parseStat(STAT)!;
    const { uptimeSec, cpuPercent } = computeMetrics(s, now, btime);
    // cpu = 3s over uptime
    expect(cpuPercent).toBeCloseTo((3 / uptimeSec) * 100, 1);
  });

  test("zero uptime does not divide by zero", () => {
    const s = parseStat(STAT)!;
    const { cpuPercent } = computeMetrics(s, btime + 123, btime);
    expect(Number.isFinite(cpuPercent)).toBe(true);
  });
});

describe("startedAtIso", () => {
  test("converts boot-relative ticks to ISO", () => {
    const s = parseStat(STAT)!;
    const iso = startedAtIso(s, 1_000_000);
    expect(new Date(iso).getTime()).toBe((1_000_000 + 123.45) * 1000);
  });
});
