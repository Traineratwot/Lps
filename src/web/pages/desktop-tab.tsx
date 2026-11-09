import React from "react";
import { InputText } from "primereact/inputtext";
import { Checkbox } from "primereact/checkbox";
import { ProgressSpinner } from "primereact/progressspinner";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";
import type { DesktopRow } from "../types.ts";
import { api } from "../api.ts";
import { IconImg } from "../components/icon-img.tsx";
import { Pager } from "../components/pagination.tsx";
import { navigate } from "../router.ts";

export function DesktopTab(): React.ReactElement {
  const [q, setQ] = React.useState("");
  const [hasIcon, setHasIcon] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(24);
  const [items, setItems] = React.useState<DesktopRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .desktop({ q, hasIcon, page, pageSize })
        .then((r) => {
          setItems(r.items);
          setTotal(r.total);
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, hasIcon, page, pageSize]);

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
            placeholder="Поиск ярлыков…"
            style={{ width: "18rem", paddingLeft: "2.5rem" }}
          />
        </span>
        <div className="flex align-items-center gap-2">
          <Checkbox inputId="deskIcon" checked={hasIcon} onChange={(e) => { setHasIcon(!!e.checked); setPage(1); }} />
          <label htmlFor="deskIcon">с иконкой</label>
        </div>
        <span className="stat-pill">{total} найдено</span>
      </div>

      {loading && (
        <div className="flex justify-content-center py-5">
          <ProgressSpinner style={{ width: "40px", height: "40px" }} />
        </div>
      )}
      {!loading && items.length === 0 && <Message severity="info" text="Ничего не найдено" />}

      <div className="card-grid">
        {items.map((d) => (
          <div
            key={d.id}
            className="program-card"
            onClick={() => navigate({ tab: "desktop", id: d.id })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && navigate({ tab: "desktop", id: d.id })}
          >
            <div className="card-head">
              <IconImg src={d.iconUrl} alt={d.name} className="card-icon" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="card-title">{d.name}</div>
                <div className="chip-row" style={{ marginTop: "0.3rem" }}>
                  {d.terminal && <Tag value="terminal" severity="warning" />}
                  {d.noDisplay && <Tag value="hidden" severity="secondary" />}
                </div>
              </div>
            </div>
            {d.comment && <div className="card-comment">{d.comment}</div>}
            <div className="chip-row" style={{ marginTop: "auto" }}>
              {d.packageName && <span className="stat-pill">{d.packageName}</span>}
              {d.commandName && <span className="stat-pill">{d.commandName}</span>}
            </div>
          </div>
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
