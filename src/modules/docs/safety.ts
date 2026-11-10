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
