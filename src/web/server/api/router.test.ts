import { describe, expect, test } from "bun:test";
import { matchApi } from "./router.ts";

function match(method: string, url: string) {
  const u = new URL(url, "http://x");
  return matchApi(method, u.pathname, u.searchParams);
}

describe("matchApi", () => {
  test("non-api paths fall through to static", () => {
    expect(match("GET", "/")).toBeNull();
    expect(match("GET", "/index.html")).toBeNull();
    expect(match("GET", "/api")).toBeNull();
  });

  test("collection routes", () => {
    expect(match("GET", "/api/health")).toEqual({ name: "health" });
    expect(match("GET", "/api/stats")).toEqual({ name: "stats" });
    expect(match("GET", "/api/programs?q=git&type=deb")).toEqual({
      name: "programs",
      query: { q: "git", type: "deb" },
    });
    expect(match("GET", "/api/commands?kind=exec")).toEqual({
      name: "commands",
      query: { kind: "exec" },
    });
    expect(match("GET", "/api/processes")).toEqual({ name: "processes", query: {} });
    expect(match("GET", "/api/desktop")).toEqual({ name: "desktop", query: {} });
  });

  test("item routes", () => {
    expect(match("GET", "/api/programs/de:12")).toEqual({ name: "program", id: "de:12" });
    expect(match("GET", "/api/programs/pkg:3")).toEqual({ name: "program", id: "pkg:3" });
    expect(match("GET", "/api/commands/7")).toEqual({ name: "command", id: 7 });
    expect(match("GET", "/api/processes/9")).toEqual({ name: "process", id: 9 });
    expect(match("GET", "/api/desktop/2")).toEqual({ name: "desktopItem", id: 2 });
    expect(match("GET", "/api/icons/5")).toEqual({ name: "icon", id: 5 });
  });

  test("numeric ids reject junk; program ids accept any slug", () => {
    expect(match("GET", "/api/commands/abc")).toBe("unknown");
    expect(match("GET", "/api/icons/1.5")).toBe("unknown");
    expect(match("GET", "/api/programs/whatever")).toEqual({ name: "program", id: "whatever" });
  });

  test("unknown api routes and non-GET methods", () => {
    expect(match("GET", "/api/nope")).toBe("unknown");
    expect(match("GET", "/api/commands/1/extra")).toBe("unknown");
    expect(match("POST", "/api/programs")).toBe("unknown");
    expect(match("DELETE", "/api/commands/1")).toBe("unknown");
  });
});
