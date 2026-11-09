import { existsSync, readFileSync } from "node:fs";

export type PasswdEntry = {
  name: string;
  uid: number;
  home: string;
  shell: string;
};

const SYSTEM_SHELLS = new Set(["/usr/sbin/nologin", "/bin/false", "/sbin/nologin", "/usr/bin/nologin", ""]);

function isLoginShell(shell: string): boolean {
  if (SYSTEM_SHELLS.has(shell)) return false;
  // real interactive shells: bash, zsh, fish, dash, sh, ksh...
  return /(?:^|\/)(ba|z|fi|da|k)?sh$|fish$/.test(shell);
}

/** All login-capable users with their home directories (from /etc/passwd). */
export function listUsers(): PasswdEntry[] {
  try {
    const content = readFileSync("/etc/passwd", "utf8");
    const result: PasswdEntry[] = [];
    for (const line of content.split(/\r?\n/)) {
      const parts = line.split(":");
      if (parts.length < 7) continue;
      const [name, , uidStr, , , home, shell] = parts as [string, string, string, string, string, string, string];
      const uid = Number.parseInt(uidStr, 10);
      if (!Number.isFinite(uid)) continue;
      if (!isLoginShell(shell)) continue;
      if (!home || !home.startsWith("/") || !existsSync(home)) continue;
      result.push({ name, uid, home, shell });
    }
    return result;
  } catch {
    return [];
  }
}

/** Home directories of all login users (deduplicated). */
export function userHomeDirs(): string[] {
  const homes = new Set<string>();
  for (const user of listUsers()) homes.add(user.home);
  return [...homes];
}
