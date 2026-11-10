import { describe, expect, test } from "bun:test";
import { parseSnapApps, parseSnapDescription, parseSnapList } from "./snap.ts";

const SNAP_LIST = `Name               Version                         Rev    Tracking       Publisher    Notes
bare               1.0                             5      latest/stable  canonical**  base
core24             20261022                        2307   latest/stable  canonical**  base
firefox            159.0.1-1                       9171   latest/stable  mozilla**    -
spotify            1.2.31.1205.g4d59ad7c6           78     latest/stable  spotify**    -
`;

const SNAP_YAML = `name: firefox
version: '159.0.1'
architectures:
  - amd64
description: |-
  Firefox is a powerful, extensible web browser
  with support for modern web technologies.
apps:
  firefox:
    command: firefox
  geckodriver:
    command: firefox.geckodriver
plugs:
  network:
`;

describe("parseSnapList", () => {
  test("parses rows and strips publisher asterisks", () => {
    const pkgs = parseSnapList(SNAP_LIST);
    expect(pkgs.length).toBe(4);
    expect(pkgs[0]).toMatchObject({
      type: "snap",
      name: "bare",
      version: "1.0",
      status: "latest/stable",
      maintainer: "canonical",
      section: "base",
    });
    expect(pkgs[2]).toMatchObject({ name: "firefox", version: "159.0.1-1", maintainer: "mozilla", section: "" });
  });

  test("header and empty lines are skipped", () => {
    expect(parseSnapList("").length).toBe(0);
    expect(parseSnapList("Name  Version  Rev\n").length).toBe(0);
  });
});

describe("parseSnapApps", () => {
  test("collects app names from the apps: block only", () => {
    expect(parseSnapApps(SNAP_YAML)).toEqual(["firefox", "geckodriver"]);
  });

  test("no apps block yields empty list", () => {
    expect(parseSnapApps("name: x\nplugs:\n  network:\n")).toEqual([]);
  });
});

describe("parseSnapDescription", () => {
  test("joins multi-line description block", () => {
    expect(parseSnapDescription(SNAP_YAML)).toBe(
      "Firefox is a powerful, extensible web browser with support for modern web technologies.",
    );
  });

  test("inline description", () => {
    expect(parseSnapDescription("description: Simple one-liner\n")).toBe("Simple one-liner");
    expect(parseSnapDescription('description: "Quoted line"\n')).toBe("Quoted line");
  });

  test("missing description", () => {
    expect(parseSnapDescription("name: x\n")).toBe("");
  });
});
