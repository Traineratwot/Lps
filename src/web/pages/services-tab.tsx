import React from "react";
import { InputText } from "primereact/inputtext";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import type { ServiceRow } from "../types.ts";
import { api } from "../api.ts";
import { navigate } from "../router.ts";

const STATE_SEVERITY: Record<string, "success" | "danger" | "warning" | "info" | "secondary"> = {
  active: "success",
  failed: "danger",
  activating: "warning",
  inactive: "secondary",
};

export function ServicesTab(): React.ReactElement {
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(24);
  const [items, setItems] = React.useState<ServiceRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .services({ q, page, pageSize })
        .then((r) => {
          setItems(r.items);
          setTotal(r.total);
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, page, pageSize]);

  return (
    <div>
      <div className="toolbar-row">
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Поиск служб…"
            style={{ width: "18rem", paddingLeft: "2.5rem" }}
          />
        </span>
        <span className="stat-pill">{total} найдено</span>
      </div>

      <DataTable
        value={items}
        loading={loading}
        stripedRows
        size="small"
        onRowClick={(e) => navigate({ tab: "services", id: (e.data as ServiceRow).id })}
        rowHover
        style={{ cursor: "pointer" }}
      >
        <Column field="name" header="Служба" sortable style={{ width: "20%" }} />
        <Column
          field="activeState"
          header="Состояние"
          style={{ width: "10%" }}
          body={(r: ServiceRow) => (
            <Tag value={r.activeState || "?"} severity={STATE_SEVERITY[r.activeState] ?? "secondary"} />
          )}
        />
        <Column field="enabledState" header="Автозапуск" style={{ width: "10%" }} />
        <Column field="mainPid" header="PID" style={{ width: "7%" }} body={(r: ServiceRow) => r.mainPid ?? "—"} />
        <Column
          field="description"
          header="Описание"
          body={(r: ServiceRow) => <span style={{ color: "var(--text-color-secondary)" }}>{r.description}</span>}
        />
        <Column field="packageName" header="Пакет" style={{ width: "13%" }} body={(r: ServiceRow) => r.packageName ?? "—"} />
        <Column field="commandName" header="Команда" style={{ width: "11%" }} body={(r: ServiceRow) => r.commandName ?? "—"} />
      </DataTable>

      <div className="toolbar-row" style={{ marginTop: "0.75rem", justifyContent: "flex-end" }}>
        <button type="button" className="p-button p-component p-button-text" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          ← Назад
        </button>
        <span className="stat-pill">
          стр. {page} из {Math.max(1, Math.ceil(total / pageSize))}
        </span>
        <button
          type="button"
          className="p-button p-component p-button-text"
          disabled={page * pageSize >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          Вперёд →
        </button>
      </div>
    </div>
  );
}
