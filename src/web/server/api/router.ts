/** Pure API route matching for the web server (unit-tested). */

export type ApiRoute =
  | { name: "health" }
  | { name: "stats" }
  | { name: "programs"; query: Record<string, string> }
  | { name: "program"; id: string }
  | { name: "commands"; query: Record<string, string> }
  | { name: "command"; id: number }
  | { name: "commandDoc"; id: number; query: Record<string, string> }
  | { name: "processes"; query: Record<string, string> }
  | { name: "process"; id: number }
  | { name: "desktop"; query: Record<string, string> }
  | { name: "desktopItem"; id: number }
  | { name: "icon"; id: number };

function queryRecord(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

function numericId(segment: string): number | null {
  const n = Number.parseInt(segment, 10);
  return Number.isFinite(n) && String(n) === segment ? n : null;
}

/**
 * Matches an HTTP request to an API route. Returns null when the request is
 * not an /api/ route (caller falls through to static files) or is unknown
 * (caller returns 404 JSON).
 */
export function matchApi(method: string, pathname: string, params: URLSearchParams): ApiRoute | "unknown" | null {
  if (!pathname.startsWith("/api/")) return null;
  if (method !== "GET" && method !== "HEAD") return "unknown";

  const segments = pathname.slice("/api/".length).split("/").filter(Boolean).map(decodeURIComponent);
  const query = queryRecord(params);

  const [a, b] = segments;
  if (segments.length === 1) {
    if (a === "health") return { name: "health" };
    if (a === "stats") return { name: "stats" };
    if (a === "programs") return { name: "programs", query };
    if (a === "commands") return { name: "commands", query };
    if (a === "processes") return { name: "processes", query };
    if (a === "desktop") return { name: "desktop", query };
    return "unknown";
  }
  if (segments.length === 2) {
    if (a === "programs") return { name: "program", id: b! };
    if (a === "commands") {
      const id = numericId(b!);
      return id != null ? { name: "command", id } : "unknown";
    }
    if (a === "processes") {
      const id = numericId(b!);
      return id != null ? { name: "process", id } : "unknown";
    }
    if (a === "desktop") {
      const id = numericId(b!);
      return id != null ? { name: "desktopItem", id } : "unknown";
    }
    if (a === "icons") {
      const id = numericId(b!);
      return id != null ? { name: "icon", id } : "unknown";
    }
  }
  if (segments.length === 3 && a === "commands" && segments[2] === "doc") {
    const id = numericId(b!);
    return id != null ? { name: "commandDoc", id, query } : "unknown";
  }
  return "unknown";
}
