/**
 * Safety rules for executing `--help` on discovered commands.
 *
 * The docs stage sweeps every executable in PATH. Some binaries (notably
 * busybox applets without long-option support) parse `--help` as a cluster
 * of short flags (`-h -e -l -p`), where `-h` on `shutdown` means HALT —
 * a Raspberry Pi rebooted twice during a scan because of this.
 *
 * Defense in depth:
 *   1. never execute these commands at all (denylist below);
 *   2. execute everything else with dropped privileges (see runCommand).
 */
import { closeSync, openSync, readSync } from "node:fs";

const DANGEROUS = new Set([
  // system state
  "reboot", "poweroff", "halt", "shutdown", "telinit", "init", "kexec",
  "runlevel", "swapoff", "swapon",
  // storage destruction
  "dd", "shred", "wipefs", "fdisk", "sfdisk", "cfdisk", "gdisk", "sgdisk",
  "parted", "partprobe", "partx", "tune2fs", "mke2fs", "mkswap", "cryptsetup",
  "losetup", "mdadm", "pvremove", "vgremove", "lvremove", "lvreduce", "zpool",
  // process / user management
  "kill", "killall", "killall5", "pkill",
  "userdel", "groupdel", "deluser", "delgroup",
  // mounts and isolation
  "mount", "umount", "chroot",
]);

/** True when running `--help` for this command is not worth the risk. */
export function isDangerousHelpCommand(nameOrPath: string): boolean {
  const base = nameOrPath.split("/").pop() ?? nameOrPath;
  return (
    DANGEROUS.has(base) ||
    /^mkfs(\.|$)/.test(base) ||
    /^fsck(\.|$)/.test(base) ||
    /^(lv|vg|pv)(create|remove|change|reduce|extend|rename)$/.test(base)
  );
}

/**
 * True when the file is a native ELF binary. Scripts (shebang) are skipped
 * for `--help`: a provisioning script like `rename-user` (Raspberry Pi
 * first-boot) ignores its arguments entirely and ends with `reboot` —
 * executing it with `--help` rebooted the machine (see PROBLEMS.md P13).
 * Real ELF CLIs virtually always parse their flags.
 */
export function isElfBinary(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    const head = Buffer.alloc(4);
    readSync(fd, head, 0, 4, 0);
    closeSync(fd);
    return head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
  } catch {
    return false;
  }
}
