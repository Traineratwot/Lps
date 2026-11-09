import { describe, expect, test } from "bun:test";
import { parseOsRelease } from "./detect.ts";

describe("parseOsRelease", () => {
  test("quoted values (Ubuntu style)", () => {
    const os = parseOsRelease(
      'NAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04"',
    );
    expect(os.id).toBe("ubuntu");
    expect(os.idLike).toEqual(["debian"]);
    expect(os.name).toBe("Ubuntu");
    expect(os.version).toBe("24.04");
  });

  test("unquoted values (P3 regression: missing closing quote broke parsing)", () => {
    const os = parseOsRelease("ID=ubuntu\nVERSION_ID=26.10\nNAME=Ubuntu\n");
    expect(os.id).toBe("ubuntu");
    expect(os.version).toBe("26.10");
    expect(os.name).toBe("Ubuntu");
  });

  test("multiple ID_LIKE entries", () => {
    const os = parseOsRelease('ID=linuxmint\nID_LIKE="ubuntu debian"\n');
    expect(os.idLike).toEqual(["ubuntu", "debian"]);
  });

  test("missing keys are empty", () => {
    const os = parseOsRelease("NAME=X\n");
    expect(os.id).toBe("");
    expect(os.idLike).toEqual([]);
  });
});
