import React from "react";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import type { CommandRow } from "../types.ts";
import { api } from "../api.ts";
import { navigate } from "../router.ts";

const KIND_OPTIONS = [
  { label: "Все виды", value: "all" },
  { label: "exec", value: "exec" },
  { label: "alias", value: "alias" },
  { label: "builtin", value: "builtin" },
  { label: "alternative", value: "alternative" },
];

export function CommandsTab(): React.ReactElement {
  const [q, setQ] = React.useState("");
  const [kind, setKind] = React.useState("all");
  const [orphan, setOrphan] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(24);
  const [items, setItems] = React.useState<CommandRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .commands({ q, kind: kind === "all" ? undefined : kind, orphan, page, pageSize })
        .then((r) => {
          setItems(r.items);
          setTotal(r.total);
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, kind, orphan, page, pageSize]);

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
            placeholder="Поиск команд…"
            style={{ width: "18rem", paddingLeft: "2.5rem" }}
          />
        </span>
        <Dropdown
          value={kind}
          options={KIND_OPTIONS}
          onChange={(e) => {
            setKind(e.value);
            setPage(1);
          }}
          style={{ width: "11rem" }}
        />
        <div className="flex align-items-center gap-2">
          <Checkbox inputId="orphan" checked={orphan} onChange={(e) => { setOrphan(!!e.checked); setPage(1); }} />
          <label htmlFor="orphan">без пакета</label>
        </div>
        <span className="stat-pill">{total} найдено</span>
      </div>

      <DataTable
        value={items}
        loading={loading}
        stripedRows
        size="small"
        onRowClick={(e) => navigate({ tab: "commands", id: (e.data as CommandRow).id })}
        rowHover
        style={{ cursor: "pointer" }}
      >
        <Column field="name" header="Имя" sortable style={{ width: "16%" }} />
        <Column
          field="kind"
          header="Вид"
          style={{ width: "9%" }}
          body={(r: CommandRow) => <Tag value={r.kind} severity={r.kind === "exec" ? "info" : "secondary"} />}
        />
        <Column field="path" header="Путь" style={{ width: "26%" }} body={(r: CommandRow) => <span style={{ fontSize: "0.82rem" }}>{r.path || "—"}</span>} />
        <Column field="summary" header="Описание" body={(r: CommandRow) => <span style={{ color: "var(--text-color-secondary)" }}>{r.summary}</span>} />
        <Column field="packageName" header="Пакет" style={{ width: "12%" }} body={(r: CommandRow) => r.packageName ?? "—"} />
        <Column field="processCount" header="Проц." style={{ width: "6%" }} />
      </DataTable>

      <div className="toolbar-row" style={{ marginTop: "0.75rem", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="p-button p-component p-button-text"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
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
