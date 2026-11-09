import { describe, expect, test } from "bun:test";
import {
  applyProgramFilter,
  mergeProgramCards,
  paginate,
  type MergeAgg,
  type MergeDesktop,
  type MergePackage,
} from "./programs.ts";

function agg(overrides: Partial<MergeAgg> = {}): MergeAgg {
  return {
    commandsByPackage: new Map(),
    commandCountByPackage: new Map(),
    runningByPackage: new Map(),
    runningByCommand: new Map(),
    ...overrides,
  };
}

const desktop: MergeDesktop = {
  id: 1,
  name: "Firefox",
  comment: "Browse the Web",
  categories: "Network;WebBrowser;",
  iconUrl: "/api/icons/1",
  packageId: 10,
  pkg: { id: 10, type: "deb", name: "firefox", version: "1.0", section: "web" },
  ownCommand: { id: 100, name: "firefox", kind: "exec", summary: "browser" },
};

const orphanPkg: MergePackage = {
  id: 20,
  type: "deb",
  name: "htop",
  version: "3.0",
  section: "utils",
  description: "process viewer",
};

describe("mergeProgramCards", () => {
  test("desktop entry becomes a de: card with icon and commands", () => {
    const cards = mergeProgramCards([desktop], [], agg({
      commandsByPackage: new Map([[10, [{ id: 101, name: "firefox-bin", kind: "exec", summary: "" }]]]),
      commandCountByPackage: new Map([[10, 2]]),
      runningByPackage: new Map([[10, 3]]),
    }));
    expect(cards.length).toBe(1);
    const c = cards[0]!;
    expect(c.id).toBe("de:1");
    expect(c.iconUrl).toBe("/api/icons/1");
    expect(c.pkg?.name).toBe("firefox");
    expect(c.commandCount).toBe(3); // 2 by package + own command (id 100 not in package list)
    expect(c.runningCount).toBe(3);
    expect(c.commands.map((x) => x.id).sort()).toEqual([100, 101]);
  });

  test("package without desktop entries becomes a pkg: card", () => {
    const cards = mergeProgramCards([], [orphanPkg], agg());
    expect(cards[0]).toMatchObject({
      id: "pkg:20",
      name: "htop",
      comment: "process viewer",
      iconUrl: null,
      desktopId: null,
    });
  });

  test("own command already counted under package is not double-counted", () => {
    const d = { ...desktop, ownCommand: { id: 101, name: "firefox-bin", kind: "exec", summary: "" } };
    const cards = mergeProgramCards([d], [], agg({
      commandsByPackage: new Map([[10, [{ id: 101, name: "firefox-bin", kind: "exec", summary: "" }]]]),
      commandCountByPackage: new Map([[10, 1]]),
    }));
    expect(cards[0]!.commandCount).toBe(1);
    expect(cards[0]!.commands.length).toBe(1);
  });

  test("desktop without package counts only its own command", () => {
    const d: MergeDesktop = { ...desktop, packageId: null, pkg: null };
    const cards = mergeProgramCards([d], [], agg());
    expect(cards[0]!.commandCount).toBe(1);
    expect(cards[0]!.runningCount).toBe(0);
  });
});

describe("applyProgramFilter", () => {
  const gimpPkg = { id: 11, type: "deb", name: "gimp", version: "2.0", section: "graphics" };
  const cards = mergeProgramCards(
    [
      desktop,
      {
        ...desktop,
        id: 2,
        name: "Gimp",
        comment: "editor",
        categories: "Graphics;",
        iconUrl: null,
        packageId: 11,
        pkg: gimpPkg,
        ownCommand: null,
      },
    ],
    [orphanPkg],
    agg({ runningByPackage: new Map([[10, 1]]) }),
  );

  test("search matches name, comment, package and categories", () => {
    expect(applyProgramFilter(cards, { page: 1, pageSize: 10, q: "gimp" }).map((c) => c.name)).toEqual(["Gimp"]);
    expect(applyProgramFilter(cards, { page: 1, pageSize: 10, q: "process viewer" }).map((c) => c.name)).toEqual(["htop"]);
    expect(applyProgramFilter(cards, { page: 1, pageSize: 10, q: "webbrowser" }).map((c) => c.name)).toEqual(["Firefox"]);
  });

  test("type / hasIcon / running filters", () => {
    expect(applyProgramFilter(cards, { page: 1, pageSize: 10, hasIcon: true }).map((c) => c.name)).toEqual(["Firefox"]);
    expect(applyProgramFilter(cards, { page: 1, pageSize: 10, running: true }).map((c) => c.name)).toEqual(["Firefox"]);
    expect(applyProgramFilter(cards, { page: 1, pageSize: 10, type: "deb" }).length).toBe(3);
  });

  test("sort name_desc", () => {
    const names = applyProgramFilter(cards, { page: 1, pageSize: 10, sort: "name_desc" }).map((c) => c.name);
    expect(names[0]).toBe("htop");
  });
});

describe("paginate", () => {
  test("slices with total", () => {
    const r = paginate([1, 2, 3, 4, 5], 2, 2);
    expect(r).toEqual({ items: [3, 4], total: 5, page: 2, pageSize: 2 });
  });
});
