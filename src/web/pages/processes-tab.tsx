import React from "react";
import { InputText } from "primereact/inputtext";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import type { ProcessRow } from "../types.ts";
import { api } from "../api.ts";
import { navigate } from "../router.ts";

export function ProcessesTab(): React.ReactElement {
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(24);
  const [sort, setSort] = React.useState<string | undefined>(undefined);
  const [order, setOrder] = React.useState<"asc" | "desc">("asc");
  const [items, setItems] = React.useState<ProcessRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .processes({ q, page, pageSize, sort, order })
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
            placeholder="Поиск по cmdline, exe, user…"
            style={{ width: "22rem" }}
          />
        </span>
        <span className="stat-pill">{total} найдено</span>
      </div>

      <DataTable
        value={items}
        loading={loading}
        stripedRows
        size="small"
        onRowClick={(e) => navigate({ tab: "processes", id: (e.data as ProcessRow).id })}
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
        <Column field="pid" sortable header="PID" style={{ width: "7%" }} />
        <Column field="user" sortable header="User" style={{ width: "9%" }} />
        <Column
          sortable
          field="cmdline"
          header="Команда"
          body={(r: ProcessRow) => (
            <span style={{ fontSize: "0.82rem" }}>{(r.cmdline || r.exePath || "(kernel)").slice(0, 70)}</span>
          )}
        />
        <Column
          sortable
          field="state"
          header="Сост."
          style={{ width: "7%" }}
          body={(r: ProcessRow) => <Tag value={r.state} severity={r.state === "R" ? "success" : "secondary"} />}
        />
        <Column sortable field="cpuPercent" header="CPU %" style={{ width: "8%" }} body={(r: ProcessRow) => r.cpuPercent ?? "—"} />
        <Column sortable field="rssKb" header="RSS, КБ" style={{ width: "9%" }} body={(r: ProcessRow) => r.rssKb ?? "—"} />
        <Column
          sortable
          field="uptimeSec"
          header="Аптайм"
          style={{ width: "9%" }}
          body={(r: ProcessRow) => (r.uptimeSec != null ? `${r.uptimeSec} с` : "—")}
        />
        <Column field="packageName" sortable header="Пакет" style={{ width: "13%" }} body={(r: ProcessRow) => r.packageName ?? "—"} />
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
