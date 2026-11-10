import React from "react";
import { Tag } from "primereact/tag";
import type { ServiceDetail } from "../../types.ts";
import { api } from "../../api.ts";
import { BackButton, LoadingBlock, useAsync } from "./shared.tsx";
import { navigate } from "../../router.ts";

const STATE_SEVERITY: Record<string, "success" | "danger" | "warning" | "info" | "secondary"> = {
  active: "success",
  failed: "danger",
  activating: "warning",
  inactive: "secondary",
};

export function ServiceDetailPage({ id }: { id: number }): React.ReactElement {
  const { data, error, loading } = useAsync<ServiceDetail>(() => api.service(id), [id]);

  if (loading || error || !data) {
    return (
      <>
        <BackButton tab="services" />
        <LoadingBlock loading={loading} error={error ?? (data ? null : "Не найдено")} />
      </>
    );
  }

  return (
    <div>
      <BackButton tab="services" />
      <div className="detail-header">
        <div>
          <h2 style={{ margin: "0 0 0.35rem" }}>
            {data.name}{" "}
            <Tag value={data.activeState || "?"} severity={STATE_SEVERITY[data.activeState] ?? "secondary"} />
          </h2>
          <div className="chip-row">
            <span className="stat-pill">autostart: {data.enabledState || "?"}</span>
            {data.subState && <span className="stat-pill">{data.subState}</span>}
            {data.mainPid != null && data.mainPid > 0 && <span className="stat-pill">PID {data.mainPid}</span>}
            {data.user && <span className="stat-pill">user: {data.user}</span>}
          </div>
        </div>
      </div>

      {data.description && (
        <div className="detail-section">
          <h3>Описание</h3>
          <p style={{ margin: 0 }}>{data.description}</p>
        </div>
      )}

      <div className="detail-section">
        <h3>Юнит</h3>
        <dl className="kv">
          <dt>Файл</dt>
          <dd>{data.unitPath || "—"}</dd>
          <dt>ExecStart</dt>
          <dd>{data.execStart || "—"}</dd>
          <dt>Исполняемый файл</dt>
          <dd>{data.execStartPath || "—"}</dd>
          {data.wantedBy && (
            <>
              <dt>WantedBy</dt>
              <dd>{data.wantedBy}</dd>
            </>
          )}
        </dl>
      </div>

      {(data.package || data.command) && (
        <div className="detail-section">
          <h3>Связи</h3>
          <dl className="kv">
            {data.package && (
              <>
                <dt>Пакет</dt>
                <dd>
                  {data.package.name} <span style={{ color: "var(--text-color-secondary)" }}>({data.package.type} {data.package.version})</span>
                </dd>
              </>
            )}
            {data.command && (
              <>
                <dt>Команда</dt>
                <dd>
                  <button
                    type="button"
                    className="back-link"
                    onClick={() => navigate({ tab: "commands", id: data.command!.id })}
                  >
                    {data.command.name}
                  </button>{" "}
                  <span style={{ color: "var(--text-color-secondary)" }}>{data.command.path}</span>
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
