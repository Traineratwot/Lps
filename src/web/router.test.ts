import { describe, expect, test } from "bun:test";
import { parseHash, serializeHash, type Route } from "./router.ts";

describe("parseHash", () => {
  test("defaults to programs list", () => {
    expect(parseHash("")).toEqual({ tab: "programs", id: null });
    expect(parseHash("#")).toEqual({ tab: "programs", id: null });
    expect(parseHash("#/")).toEqual({ tab: "programs", id: null });
  });

  test("tabs without ids", () => {
    expect(parseHash("#/commands")).toEqual({ tab: "commands", id: null });
    expect(parseHash("#/processes")).toEqual({ tab: "processes", id: null });
    expect(parseHash("#/desktop")).toEqual({ tab: "desktop", id: null });
    expect(parseHash("#/commands/")).toEqual({ tab: "commands", id: null });
  });

  test("program detail id keeps its slug", () => {
    expect(parseHash("#/programs/de:12")).toEqual({ tab: "programs", id: "de:12" });
    expect(parseHash("#/programs/pkg:3")).toEqual({ tab: "programs", id: "pkg:3" });
    expect(parseHash("#/programs/de%3A12")).toEqual({ tab: "programs", id: "de:12" });
  });

  test("numeric detail ids", () => {
    expect(parseHash("#/commands/7")).toEqual({ tab: "commands", id: 7 });
    expect(parseHash("#/processes/9")).toEqual({ tab: "processes", id: 9 });
    expect(parseHash("#/desktop/2")).toEqual({ tab: "desktop", id: 2 });
  });

  test("junk falls back safely", () => {
    expect(parseHash("#/commands/abc")).toEqual({ tab: "commands", id: null });
    expect(parseHash("#/nope")).toEqual({ tab: "programs", id: null });
  });
});

describe("serializeHash", () => {
  test("round-trips routes", () => {
    const routes: Route[] = [
      { tab: "programs", id: null },
      { tab: "programs", id: "de:5" },
      { tab: "commands", id: 3 },
      { tab: "processes", id: null },
      { tab: "desktop", id: 42 },
    ];
    for (const r of routes) {
      expect(parseHash(serializeHash(r))).toEqual(r);
    }
  });
});
