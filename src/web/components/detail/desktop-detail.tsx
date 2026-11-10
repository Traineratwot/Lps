import React from "react";
import { Tag } from "primereact/tag";
import type { DesktopRow } from "../../types.ts";
import { api } from "../../api.ts";
import { IconImg } from "../icon-img.tsx";
import { BackButton, EmptyHint, LoadingBlock, useAsync } from "./shared.tsx";

export function DesktopDetailPage({ id }: { id: number }): React.ReactElement {
  const { data, error, loading } = useAsync<DesktopRow | null>(
    () => api.desktop({ id }).then((r) => r.items[0] ?? null),
    [id],
  );

  if (loading || error || !data) {
    return (
      <>
        <BackButton tab="desktop" />
        <LoadingBlock loading={loading} error={error ?? (data ? null : "Не найдено")} />
      </>
    );
  }

  return (
    <div>
      <BackButton tab="desktop" />
      <div className="detail-header">
        <IconImg src={data.iconUrl} alt={data.name} className="detail-icon" />
        <div>
          <h2 style={{ margin: "0 0 0.35rem" }}>{data.name}</h2>
          <div className="chip-row">
            {data.terminal && <Tag value="terminal" severity="warning" />}
            {data.noDisplay && <Tag value="noDisplay" severity="secondary" />}
            {data.hidden && <Tag value="hidden" severity="secondary" />}
            {data.packageName && <span className="stat-pill">{data.packageName}</span>}
          </div>
        </div>
      </div>

      <div className="detail-section">
        <h3>Описание</h3>
        {data.comment ? (
          <p style={{ margin: 0 }}>{data.comment}</p>
        ) : (
          <EmptyHint />
        )}
      </div>

      <div className="detail-section">
        <h3>Ярлык</h3>
        <dl className="kv">
          <dt>Файл</dt>
          <dd>{data.filePath}</dd>
          <dt>Exec</dt>
          <dd>{data.exec}</dd>
          <dt>Иконка</dt>
          <dd>{data.iconName || "—"}</dd>
          <dt>Категории</dt>
          <dd>{data.categories || "—"}</dd>
          <dt>Команда</dt>
          <dd>{data.commandName ?? "—"}</dd>
        </dl>
      </div>
    </div>
  );
}
