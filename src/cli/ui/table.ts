export type Column = {
  header: string;
  value: (row: unknown) => string;
  width?: number;
};

/**
 * Plain fixed-width table renderer (no deps). Right-pad columns, dim headers.
 */
export function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "(empty)";
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[], pad: (s: string, w: number) => string): string =>
    cells.map((c, i) => pad(c ?? "", widths[i]!)).join("  ");

  const out: string[] = [];
  out.push(line(headers, (s, w) => s.padEnd(w)));
  out.push(line(widths.map((w) => "-".repeat(w)), (s) => s));
  for (const row of rows) out.push(line(row, (s, w) => s.padEnd(w)));
  return out.join("\n");
}
