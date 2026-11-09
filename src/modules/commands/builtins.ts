import type { RawCommand } from "../../core/types.ts";
import { runCommand, which } from "../../core/util/exec.ts";

const FALLBACK_BUILTINS = [
  "alias", "bg", "bind", "break", "builtin", "case", "cd", "command", "compgen",
  "complete", "continue", "declare", "dirs", "disown", "echo", "enable", "eval",
  "exec", "exit", "export", "false", "fc", "fg", "getopts", "hash", "help",
  "history", "jobs", "kill", "let", "local", "logout", "mapfile", "popd",
  "printf", "pushd", "pwd", "read", "readarray", "readonly", "return", "set",
  "shift", "shopt", "source", "suspend", "test", "times", "trap", "true",
  "type", "typeset", "ulimit", "umask", "unalias", "unset", "wait",
];

/** Shell builtins (bash). Falls back to a static list when bash is unavailable. */
export function scanBuiltins(): RawCommand[] {
  let names = FALLBACK_BUILTINS;
  if (which("bash")) {
    const res = runCommand(["bash", "-c", "compgen -b"], { timeoutMs: 3000 });
    if (res.ok && res.stdout.trim()) {
      names = res.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return names.map((name) => ({
    name,
    kind: "builtin" as const,
    path: "",
    realPath: "",
    aliasOf: "",
    source: "builtin",
    isSymlink: false,
    size: null,
    mode: null,
    ownerId: null,
  }));
}
