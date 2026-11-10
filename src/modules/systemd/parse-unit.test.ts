import { describe, expect, test } from "bun:test";
import { execPathFromShow, parseUnitFile } from "./parse-unit.ts";

const SSHD = `[Unit]
Description=OpenBSD Secure Shell server
After=network.target auditd.service

[Service]
Type=notify
ExecStartPre=/usr/sbin/sshd -t
ExecStart=/usr/sbin/sshd -D $SSHD_OPTS
ExecReload=/bin/kill -HUP $MAINPID
KillMode=process
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
Alias=sshd.service
`;

const CONTINUED = `[Service]
Description=Long running
ExecStart=/usr/bin/foo --flag a \\
  --other b
WantedBy=multi-user.target
`;

const PREFIXED = `[Service]
Description=Best effort
ExecStart=-/opt/tool/bin/run --x
`;

describe("parseUnitFile", () => {
  test("parses description, exec, user and WantedBy", () => {
    const u = parseUnitFile(SSHD);
    expect(u.description).toBe("OpenBSD Secure Shell server");
    expect(u.execStart).toBe("/usr/sbin/sshd -D $SSHD_OPTS");
    expect(u.execStartPath).toBe("/usr/sbin/sshd");
    expect(u.user).toBe("root");
    expect(u.wantedBy).toBe("multi-user.target");
  });

  test("first ExecStart wins; ExecStartPre ignored", () => {
    const u = parseUnitFile(SSHD);
    expect(u.execStart.startsWith("/usr/sbin/sshd -D")).toBe(true);
    expect(u.execStartPath).not.toBe("/usr/sbin/sshd -t");
  });

  test("backslash continuations are joined", () => {
    const u = parseUnitFile(CONTINUED);
    expect(u.execStart).toBe("/usr/bin/foo --flag a --other b");
  });

  test("systemd exec prefixes are stripped from the path", () => {
    const u = parseUnitFile(PREFIXED);
    expect(u.execStartPath).toBe("/opt/tool/bin/run");
    expect(u.execStart).toBe("-/opt/tool/bin/run --x");
  });

  test("non-absolute ExecStart yields empty path", () => {
    const u = parseUnitFile("[Service]\nExecStart=env foo\n");
    expect(u.execStartPath).toBe("");
  });
});

describe("execPathFromShow", () => {
  test("extracts path= from systemctl show block", () => {
    const block =
      "{ path=/usr/libexec/accounts-daemon ; argv[]=/usr/libexec/accounts-daemon ; ignore_errors=no ; pid=1337 }";
    expect(execPathFromShow(block)).toBe("/usr/libexec/accounts-daemon");
  });

  test("empty block yields empty path", () => {
    expect(execPathFromShow("")).toBe("");
  });
});
