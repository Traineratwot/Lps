import React from "react";
import { Tag } from "primereact/tag";
import type { ProgramDetail } from "../../types.ts";
import { api } from "../../api.ts";
import { IconImg } from "../icon-img.tsx";
import { BackButton, LoadingBlock, useAsync } from "./shared.tsx";
import { navigate } from "../../router.ts";

export function ProgramDetailPage({ id }: { id: string }): React.ReactElement {
  const { data, error, loading } = useAsync<ProgramDetail>(() => api.program(id), [id]);

  if (loading || error || !data) {
    return (
      <>
        <BackButton tab="programs" />
        <LoadingBlock loading={loading} error={error ?? (data ? null : "Не найдено")} />
      </>
    );
  }

  return (
    <div>
      <BackButton tab="programs" />
      <div className="detail-header">
        <IconImg src={data.iconUrl} alt={data.name} className="detail-icon" />
        <div>
          <h2 style={{ margin: "0 0 0.35rem" }}>{data.name}</h2>
          <div className="chip-row">
            {data.pkg && <Tag value={`${data.pkg.type} ${data.pkg.version}`} severity="info" />}
            {data.runningCount > 0 && <Tag value={`● запущено: ${data.runningCount}`} severity="success" />}
            {data.categories
              .split(";")
              .filter(Boolean)
              .map((c) => (
                <span key={c} className="stat-pill">
                  {c}
                </span>
              ))}
          </div>
        </div>
      </div>

      {(data.comment || data.package?.description) && (
        <div className="detail-section">
          <h3>Описание</h3>
          <p style={{ margin: 0 }}>{data.comment || data.package?.description}</p>
        </div>
      )}

      {data.package && (
        <div className="detail-section">
          <h3>Пакет</h3>
          <dl className="kv">
            <dt>Имя</dt>
            <dd>{data.package.name}</dd>
            <dt>Тип / версия</dt>
            <dd>
              {data.package.type} / {data.package.version || "—" }
            </dd>
            <dt>Секция</dt>
            <dd>{data.package.section || "—"}</dd>
            <dt>Архитектура</dt>
            <dd>{data.package.architecture || "—"}</dd>
            <dt>Сопровождающий</dt>
            <dd>{data.package.maintainer || "—"}</dd>
            {data.package.origin && (
              <>
                <dt>Источник</dt>
                <dd>{data.package.origin}</dd>
              </>
            )}
            {data.package.installPath && (
              <>
                <dt>Путь установки</dt>
                <dd>{data.package.installPath}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {data.desktop && (
        <div className="detail-section">
          <h3>Ярлык (.desktop)</h3>
          <dl className="kv">
            <dt>Файл</dt>
            <dd>{data.desktop.filePath}</dd>
            <dt>Exec</dt>
            <dd>{data.desktop.exec}</dd>
            <dt>Иконка</dt>
            <dd>{data.desktop.iconName || "—"}</dd>
            <dt>MIME</dt>
            <dd>{data.desktop.mimeTypes || "—"}</dd>
            <dt>WM class</dt>
            <dd>{data.desktop.wmClass || "—"}</dd>
          </dl>
        </div>
      )}

      {data.commandsFull.length > 0 && (
        <div className="detail-section">
          <h3>Команды ({data.commandsFull.length})</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-color-secondary)" }}>
                <th style={{ padding: "0.3rem 0.5rem" }}>Имя</th>
                <th style={{ padding: "0.3rem 0.5rem" }}>Вид</th>
                <th style={{ padding: "0.3rem 0.5rem" }}>Путь</th>
                <th style={{ padding: "0.3rem 0.5rem" }}>Описание</th>
              </tr>
            </thead>
            <tbody>
              {data.commandsFull.map((c) => (
                <tr
                  key={c.id}
                  style={{ borderTop: "1px solid var(--surface-200)", cursor: "pointer" }}
                  onClick={() => navigate({ tab: "commands", id: c.id })}
                >
                  <td style={{ padding: "0.35rem 0.5rem" }}>{c.name}</td>
                  <td style={{ padding: "0.35rem 0.5rem" }}>{c.kind}</td>
                  <td style={{ padding: "0.35rem 0.5rem", color: "var(--text-color-secondary)" }}>{c.paths[0] || "—"}</td>
                  <td style={{ padding: "0.35rem 0.5rem", color: "var(--text-color-secondary)" }}>{c.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.processes.length > 0 && (
        <div className="detail-section">
          <h3>Процессы ({data.processes.length})</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-color-secondary)" }}>
                <th style={{ padding: "0.3rem 0.5rem" }}>PID</th>
                <th style={{ padding: "0.3rem 0.5rem" }}>User</th>
                <th style={{ padding: "0.3rem 0.5rem" }}>Cmdline</th>
                <th style={{ padding: "0.3rem 0.5rem" }}>CPU %</th>
                <th style={{ padding: "0.3rem 0.5rem" }}>RSS КБ</th>
                <th style={{ padding: "0.3rem 0.5rem" }}>Аптайм</th>
              </tr>
            </thead>
            <tbody>
              {data.processes.map((p) => (
                <tr
                  key={p.id}
                  style={{ borderTop: "1px solid var(--surface-200)", cursor: "pointer" }}
                  onClick={() => navigate({ tab: "processes", id: p.id })}
                >
                  <td style={{ padding: "0.35rem 0.5rem" }}>{p.pid}</td>
                  <td style={{ padding: "0.35rem 0.5rem" }}>{p.user}</td>
                  <td style={{ padding: "0.35rem 0.5rem" }}>{(p.cmdline || "(kernel)").slice(0, 50)}</td>
                  <td style={{ padding: "0.35rem 0.5rem" }}>{p.cpuPercent ?? "—"}</td>
                  <td style={{ padding: "0.35rem 0.5rem" }}>{p.rssKb ?? "—"}</td>
                  <td style={{ padding: "0.35rem 0.5rem" }}>{p.uptimeSec != null ? `${p.uptimeSec} с` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
