import React from "react";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { ProgressSpinner } from "primereact/progressspinner";
import { Message } from "primereact/message";
import type { ProgramCard } from "../types.ts";
import { api } from "../api.ts";
import { ProgramCardView } from "../components/program-card.tsx";
import { Pager } from "../components/pagination.tsx";

const TYPE_OPTIONS = [
  { label: "Все типы", value: "all" },
  { label: "deb", value: "deb" },
  { label: "flatpak", value: "flatpak" },
  { label: "appimage", value: "appimage" },
];

export function ProgramsTab(): React.ReactElement {
  const [q, setQ] = React.useState("");
  const [type, setType] = React.useState("all");
  const [hasIcon, setHasIcon] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [sort, setSort] = React.useState("name_asc");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(24);
  const [items, setItems] = React.useState<ProgramCard[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      api
        .programs({ q, type: type === "all" ? undefined : type, hasIcon, running, sort, page, pageSize })
        .then((r) => {
          setItems(r.items);
          setTotal(r.total);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, type, hasIcon, running, sort, page, pageSize]);

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
            placeholder="Поиск программ…"
            style={{ width: "18rem", paddingLeft: "2.5rem" }}
          />
        </span>
        <Dropdown
          value={type}
          options={TYPE_OPTIONS}
          onChange={(e) => {
            setType(e.value);
            setPage(1);
          }}
          style={{ width: "10rem" }}
        />
        <Dropdown
          value={sort}
          options={[
            { label: "По имени", value: "name_asc" },
            { label: "Имя ↓", value: "name_desc" },
            { label: "Сначала запущенные", value: "running" },
          ]}
          onChange={(e) => setSort(e.value)}
          style={{ width: "12rem" }}
        />
        <div className="flex align-items-center gap-2">
          <Checkbox inputId="hasIcon" checked={hasIcon} onChange={(e) => { setHasIcon(!!e.checked); setPage(1); }} />
          <label htmlFor="hasIcon">с иконкой</label>
        </div>
        <div className="flex align-items-center gap-2">
          <Checkbox inputId="running" checked={running} onChange={(e) => { setRunning(!!e.checked); setPage(1); }} />
          <label htmlFor="running">запущенные</label>
        </div>
        <span className="stat-pill">{total} найдено</span>
      </div>

      {error && <Message severity="error" text={error} />}
      {loading && (
        <div className="flex justify-content-center py-5">
          <ProgressSpinner style={{ width: "40px", height: "40px" }} />
        </div>
      )}
      {!loading && items.length === 0 && !error && <Message severity="info" text="Ничего не найдено" />}

      <div className="card-grid">
        {items.map((c) => (
          <ProgramCardView key={c.id} card={c} />
        ))}
      </div>

      <Pager
        total={total}
        page={page}
        pageSize={pageSize}
        onPage={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
      />
    </div>
  );
}
