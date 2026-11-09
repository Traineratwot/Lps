import React from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import type { ProcessDetail } from "../../types.ts";
import { api } from "../../api.ts";
import { BackButton, LoadingBlock, useAsync } from "./shared.tsx";

export function ProcessDetailPage({ id }: { id: number }): React.ReactElement {
  const { data, error, loading } = useAsync<ProcessDetail>(() => api.process(id), [id]);

  if (loading || error || !data) {
    return (
      <>
        <BackButton tab="processes" />
        <LoadingBlock loading={loading} error={error ?? (data ? null : "Не найдено")} />
      </>
    );
  }

  return (
    <div>
      <BackButton tab="processes" />
      <div className="detail-header">
        <div>
          <h2 style={{ margin: "0 0 0.35rem" }}>
            PID {data.pid}{" "}
            <span style={{ fontWeight: 400, color: "var(--text-color-secondary)", fontSize: "0.95rem" }}>
              {data.commandName ?? data.exePath ?? "(kernel)"}
            </span>
          </h2>
          <div className="chip-row">
            <span className="stat-pill">{data.user || "?"}</span>
            {data.isKernel && <span className="stat-pill">kernel thread</span>}
            {data.packageName && <span className="stat-pill">{data.packageName}</span>}
          </div>
        </div>
      </div>

      <div className="detail-section">
        <h3>Процесс</h3>
        <dl className="kv">
          <dt>Cmdline</dt>
          <dd>{data.cmdline || "(пусто)"}</dd>
          <dt>exe</dt>
          <dd>{data.exePath || "—"}</dd>
          <dt>UID</dt>
          <dd>{data.uid ?? "—"}</dd>
          <dt>PPID</dt>
          <dd>{data.ppid ?? "—"}</dd>
          <dt>Запущен</dt>
          <dd>{new Date(data.startedAt).toLocaleString("ru-RU")}</dd>
        </dl>
      </div>

      <div className="detail-section">
        <h3>Снапшоты ({data.snapshots.length})</h3>
        <DataTable value={data.snapshots} stripedRows size="small">
          <Column field="observedAt" header="Наблюдение" body={(s: { observedAt: string }) => new Date(s.observedAt).toLocaleString("ru-RU")} />
          <Column field="uptimeSec" header="Аптайм, с" />
          <Column field="cpuPercent" header="CPU %" body={(s: { cpuPercent: number | null }) => s.cpuPercent ?? "—"} />
          <Column field="rssKb" header="RSS, КБ" body={(s: { rssKb: number | null }) => s.rssKb ?? "—"} />
          <Column field="state" header="Сост." />
          <Column field="threads" header="Потоки" body={(s: { threads: number | null }) => s.threads ?? "—"} />
        </DataTable>
      </div>
    </div>
  );
}
