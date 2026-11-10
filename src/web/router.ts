/** Minimal hash router (pure, unit-tested). */

export type Tab = "programs" | "commands" | "processes" | "services" | "desktop";

export type Route =
  | { tab: "programs"; id: string | null }
  | { tab: "commands"; id: number | null }
  | { tab: "processes"; id: number | null }
  | { tab: "services"; id: number | null }
  | { tab: "desktop"; id: number | null };

const TABS: Tab[] = ["programs", "commands", "processes", "services", "desktop"];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [tabRaw, idRaw] = raw.split("/");
  const tab = TABS.find((t) => t === tabRaw) ?? "programs";

  if (idRaw === undefined || idRaw === "") {
    return { tab, id: null } as Route;
  }
  if (tab === "programs") {
    return { tab, id: decodeURIComponent(idRaw) };
  }
  const n = Number.parseInt(idRaw, 10);
  return { tab, id: Number.isFinite(n) ? n : null } as Route;
}

export function serializeHash(route: Route): string {
  if (route.id == null) return `#/${route.tab}`;
  return `#/${route.tab}/${route.id}`;
}

export function navigate(route: Route): void {
  window.location.hash = serializeHash(route);
}
