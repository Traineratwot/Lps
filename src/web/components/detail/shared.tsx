import React from "react";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { navigate, type Tab } from "../../router.ts";
import type { LinkedService } from "../../types.ts";

export function BackButton({ tab }: { tab: Tab }): React.ReactElement {
  return (
    <button type="button" className="back-link" onClick={() => navigate({ tab, id: null } as never)}>
      <i className="pi pi-arrow-left" /> Назад к списку
    </button>
  );
}

const STATE_SEVERITY: Record<string, "success" | "danger" | "warning" | "info" | "secondary"> = {
  active: "success",
  failed: "danger",
  activating: "warning",
  inactive: "secondary",
};

/** Placeholder shown inside a block that has no data — keeps the block visible. */
export function EmptyHint(): React.ReactElement {
  return <div className="empty-hint">нет данных</div>;
}

/** Compact systemd services block for program/command cards. */
export function ServicesBlock({ services }: { services: LinkedService[] }): React.ReactElement {
  return (
    <div className="detail-section">
      <h3>Службы systemd{services.length > 0 ? ` (${services.length})` : ""}</h3>
      {services.length === 0 ? (
        <EmptyHint />
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-color-secondary)" }}>
              <th style={{ padding: "0.3rem 0.5rem" }}>Служба</th>
              <th style={{ padding: "0.3rem 0.5rem" }}>Состояние</th>
              <th style={{ padding: "0.3rem 0.5rem" }}>Автозапуск</th>
              <th style={{ padding: "0.3rem 0.5rem" }}>PID</th>
              <th style={{ padding: "0.3rem 0.5rem" }}>Описание</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr
                key={s.id}
                style={{ borderTop: "1px solid var(--surface-200)", cursor: "pointer" }}
                onClick={() => navigate({ tab: "services", id: s.id })}
              >
                <td style={{ padding: "0.35rem 0.5rem" }}>{s.name}</td>
                <td style={{ padding: "0.35rem 0.5rem" }}>
                  <Tag value={s.activeState || "?"} severity={STATE_SEVERITY[s.activeState] ?? "secondary"} />
                </td>
                <td style={{ padding: "0.35rem 0.5rem" }}>{s.enabledState || "—"}</td>
                <td style={{ padding: "0.35rem 0.5rem" }}>{s.mainPid ?? "—"}</td>
                <td style={{ padding: "0.35rem 0.5rem", color: "var(--text-color-secondary)" }}>{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    setLoading(true);
    loader()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading };
}

export function LoadingBlock({ loading, error }: { loading: boolean; error: string | null }): React.ReactElement | null {
  if (loading) return <div className="flex justify-content-center py-5">Загрузка…</div>;
  if (error) return <div className="detail-section">Ошибка: {error}</div>;
  return null;
}

export { Button };
