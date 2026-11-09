import { describe, expect, test } from "bun:test";
import { parseStanza, toRawPackage } from "./dpkg.ts";

const STANZA = `Package: git
Status: install ok installed
Priority: optional
Section: vcs
Installed-Size: 42000
Maintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>
Architecture: amd64
Version: 1:2.55.0-1ubuntu1.1
Description: fast, scalable, distributed revision control system
 Git is a fast, scalable, distributed revision control system.
 .
 Second paragraph.
Homepage: https://git-scm.com/
`;

describe("parseStanza", () => {
  test("parses fields and folded continuation lines", () => {
    const f = parseStanza(STANZA);
    expect(f.Package).toBe("git");
    expect(f.Version).toBe("1:2.55.0-1ubuntu1.1");
    expect(f.Status).toBe("install ok installed");
    expect(f.Description).toContain("Git is a fast");
    expect(f.Description).toContain("Second paragraph.");
  });
});

describe("toRawPackage", () => {
  test("maps a full stanza", () => {
    const pkg = toRawPackage(parseStanza(STANZA));
    expect(pkg).not.toBeNull();
    expect(pkg!.type).toBe("deb");
    expect(pkg!.name).toBe("git");
    expect(pkg!.version).toBe("1:2.55.0-1ubuntu1.1");
    expect(pkg!.architecture).toBe("amd64");
    // short description only (first line)
    expect(pkg!.description).toBe("fast, scalable, distributed revision control system");
    expect(pkg!.section).toBe("vcs");
    expect(pkg!.maintainer).toContain("Ubuntu Developers");
  });

  test("skips non-installed packages", () => {
    expect(toRawPackage({ Package: "x", Status: "deinstall ok config-files" })).toBeNull();
    expect(toRawPackage({ Package: "x", Status: "install ok unpacked" })).toBeNull();
  });

  test("skips stanzas without Package", () => {
    expect(toRawPackage({ Status: "install ok installed" })).toBeNull();
  });
});
