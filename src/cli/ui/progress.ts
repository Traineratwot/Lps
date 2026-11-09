import { bold, dim, green, truncate } from "./style.ts";

const BAR_WIDTH = 22;

export type ProgressOptions = {
  total: number;
  title: string;
};

/**
 * Single-line ANSI progress bar:
 *   scanning commands  [████████░░░░░░░░░░░░░░]  36%  640/1762  /usr/bin/curl
 * Falls back to periodic plain lines when stdout is not a TTY.
 */
export class ProgressBar {
  private current = 0;
  private startedAt = Date.now();
  private lastPlainAt = 0;
  private finished = false;

  constructor(
    private readonly title: string,
    private readonly total: number,
  ) {}

  update(current: number, label = ""): void {
    this.current = current;
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${this.render(label)}`);
    } else {
      const now = Date.now();
      if (now - this.lastPlainAt > 2000 || current >= this.total) {
        this.lastPlainAt = now;
        process.stdout.write(`${this.render(label)}\n`);
      }
    }
  }

  tick(label = ""): void {
    this.update(this.current + 1, label);
  }

  private render(label: string): string {
    const total = Math.max(this.total, 1);
    const ratio = Math.min(this.current / total, 1);
    const filled = Math.round(ratio * BAR_WIDTH);
    const bar = green("█".repeat(filled)) + dim("░".repeat(BAR_WIDTH - filled));
    const pct = String(Math.round(ratio * 100)).padStart(3, " ");
    const counter = `${this.current}/${this.total}`.padStart(11, " ");
    const labelPart = label ? `  ${dim(truncate(label, 40))}` : "";
    return `${this.title.padEnd(18, " ")} [${bar}] ${pct}% ${counter}${labelPart}`;
  }

  /** Clears the bar line and prints a final summary. */
  done(summary = ""): void {
    if (this.finished) return;
    this.finished = true;
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${" ".repeat(100)}\r`);
    }
    const status = summary || `${this.current} items in ${elapsed}s`;
    process.stdout.write(`${green("✓")} ${bold(this.title)} ${dim(status)}\n`);
  }

  /** Prints an error line above the bar. */
  fail(message: string): void {
    if (this.finished) return;
    this.finished = true;
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${" ".repeat(100)}\r`);
    }
    process.stdout.write(`✗ ${this.title}: ${message}\n`);
  }
}
