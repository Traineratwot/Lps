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
  const [sort, setSort] = React.useState<string | undefined>(undefined);
  const [order, setOrder] = React.useState<"asc" | "desc">("asc");
  const [items, setItems] = React.useState<ServiceRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .services({ q, page, pageSize, sort, order })
        .then((r) => {
          setItems(r.items);
          setTotal(r.total);
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, page, pageSize, sort, order]);

  return (
    <div>
      <div className="toolbar-row">
        <span className="search-box">
          <i className="pi pi-search" />
          <InputText
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Поиск служб…"
            style={{ width: "18rem" }}
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
        sortField={sort}
        sortOrder={order === "desc" ? -1 : 1}
        onSort={(e) => {
          setSort(e.sortField as string);
          setOrder(e.sortOrder === -1 ? "desc" : "asc");
          setPage(1);
        }}
      >
        <Column field="name" header="Служба" sortable style={{ width: "20%" }} />
        <Column
          sortable
          field="activeState"
          header="Состояние"
          style={{ width: "10%" }}
          body={(r: ServiceRow) => (
            <Tag value={r.activeState || "?"} severity={STATE_SEVERITY[r.activeState] ?? "secondary"} />
          )}
        />
        <Column sortable field="enabledState" header="Автозапуск" style={{ width: "10%" }} />
        <Column sortable field="mainPid" header="PID" style={{ width: "7%" }} body={(r: ServiceRow) => r.mainPid ?? "—"} />
        <Column
          sortable
          field="description"
          header="Описание"
          body={(r: ServiceRow) => <span style={{ color: "var(--text-color-secondary)" }}>{r.description}</span>}
        />
        <Column field="packageName" sortable header="Пакет" style={{ width: "13%" }} body={(r: ServiceRow) => r.packageName ?? "—"} />
        <Column field="commandName" sortable header="Команда" style={{ width: "11%" }} body={(r: ServiceRow) => r.commandName ?? "—"} />
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
