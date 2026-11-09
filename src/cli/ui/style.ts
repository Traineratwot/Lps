const isTty = (): boolean =>
  typeof process.stdout.isTTY === "boolean" && process.stdout.isTTY && process.env.NO_COLOR === undefined;

const wrap = (open: string, close: string) => (text: string): string =>
  isTty() ? `${open}${text}${close}` : text;

export const bold = wrap("\x1b[1m", "\x1b[22m");
export const dim = wrap("\x1b[2m", "\x1b[22m");
export const red = wrap("\x1b[31m", "\x1b[39m");
export const green = wrap("\x1b[32m", "\x1b[39m");
export const yellow = wrap("\x1b[33m", "\x1b[39m");
export const cyan = wrap("\x1b[36m", "\x1b[39m");

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + "…";
}
