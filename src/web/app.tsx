import React from "react";
import { TabView, TabPanel } from "primereact/tabview";
import { InputSwitch } from "primereact/inputswitch";
import { parseHash, navigate, type Route, type Tab } from "./router.ts";
import type { StatsResp } from "./types.ts";
import { api } from "./api.ts";
import { applyTheme, currentTheme, type ThemeName } from "./theme.ts";
import { ProgramsTab } from "./pages/programs-tab.tsx";
import { CommandsTab } from "./pages/commands-tab.tsx";
import { ProcessesTab } from "./pages/processes-tab.tsx";
import { DesktopTab } from "./pages/desktop-tab.tsx";
import { ProgramDetailPage } from "./components/detail/program-detail.tsx";
import { CommandDetailPage } from "./components/detail/command-detail.tsx";
import { ProcessDetailPage } from "./components/detail/process-detail.tsx";
import { DesktopDetailPage } from "./components/detail/desktop-detail.tsx";

const TAB_INDEX: Record<Tab, number> = { programs: 0, commands: 1, processes: 2, desktop: 3 };

function useHashRoute(): Route {
  const [route, setRoute] = React.useState<Route>(() => parseHash(window.location.hash));
  React.useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

function StatsBar({ stats }: { stats: StatsResp | null }): React.ReactElement {
  if (!stats) return <></>;
  return (
    <div className="chip-row">
      <span className="stat-pill">
        <i className="pi pi-box" /> {stats.packages} пакетов
      </span>
      <span className="stat-pill">
        <i className="pi pi-code" /> {stats.commands} команд
      </span>
      <span className="stat-pill">
        <i className="pi pi-desktop" /> {stats.desktopEntries} ярлыков
      </span>
      <span className="stat-pill">
        <i className="pi pi-spin pi-cog" /> {stats.processes} процессов
      </span>
      {stats.lastScan && (
        <span className="stat-pill">
          <i className="pi pi-clock" /> скан {new Date(stats.lastScan).toLocaleString("ru-RU")}
        </span>
      )}
    </div>
  );
}

function ThemeToggle(): React.ReactElement {
  const [theme, setTheme] = React.useState<ThemeName>(() => currentTheme());
  const toggle = (next: ThemeName): void => {
    setTheme(next);
    applyTheme(next);
  };
  return (
    <div className="flex align-items-center gap-2" style={{ marginLeft: "auto" }}>
      <i className={theme === "dark" ? "pi pi-moon" : "pi pi-sun"} />
      <InputSwitch
        checked={theme === "dark"}
        onChange={(e) => toggle(e.value ? "dark" : "light")}
        aria-label="Тёмная тема"
      />
    </div>
  );
}

export function App(): React.ReactElement {
  const route = useHashRoute();
  const [stats, setStats] = React.useState<StatsResp | null>(null);

  React.useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null));
  }, []);

  const goTab = (index: number): void => {
    const tab = (Object.keys(TAB_INDEX) as Tab[]).find((t) => TAB_INDEX[t] === index) ?? "programs";
    navigate({ tab, id: null } as Route);
  };

  return (
    <>
      <header className="app-header">
        <h1>
          <i className="pi pi-server" /> LPS — индекс программ
        </h1>
        <StatsBar stats={stats} />
        <ThemeToggle />
      </header>
      <main className="app-main">
        {route.id != null ? (
          <>
            {route.tab === "programs" && <ProgramDetailPage id={String(route.id)} />}
            {route.tab === "commands" && <CommandDetailPage id={Number(route.id)} />}
            {route.tab === "processes" && <ProcessDetailPage id={Number(route.id)} />}
            {route.tab === "desktop" && <DesktopDetailPage id={Number(route.id)} />}
          </>
        ) : (
          <TabView activeIndex={TAB_INDEX[route.tab]} onTabChange={(e) => goTab(e.index)}>
            <TabPanel header="Программы" leftIcon="pi pi-th-large">
              <ProgramsTab />
            </TabPanel>
            <TabPanel header="Команды" leftIcon="pi pi-code">
              <CommandsTab />
            </TabPanel>
            <TabPanel header="Процессы" leftIcon="pi pi-cog">
              <ProcessesTab />
            </TabPanel>
            <TabPanel header="Ярлыки" leftIcon="pi pi-desktop">
              <DesktopTab />
            </TabPanel>
          </TabView>
        )}
      </main>
    </>
  );
}
