import React from "react";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import type { CommandDetail, DocText } from "../../types.ts";
import { api } from "../../api.ts";
import { BackButton, LoadingBlock, useAsync } from "./shared.tsx";

function DocViewer({ command }: { command: CommandDetail }): React.ReactElement {
  const [active, setActive] = React.useState<"man" | "help" | null>(null);
  const [doc, setDoc] = React.useState<DocText | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = (kind: "man" | "help"): void => {
    setActive(kind);
    setLoading(true);
    setError(null);
    setDoc(null);
    api
      .commandDoc(command.id, kind)
      .then(setDoc)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const hasMan = Boolean(command.doc?.manPath);
  const hasHelp = command.kind !== "alias" || command.aliases.length > 0;

  return (
    <div className="detail-section">
      <h3>Документация</h3>
      <div className="toolbar-row" style={{ marginBottom: "0.75rem" }}>
        <Button
          label="Man-страница"
          icon="pi pi-book"
          size="small"
          severity={active === "man" ? undefined : "secondary"}
          outlined={active !== "man"}
          disabled={!hasMan}
          onClick={() => load("man")}
        />
        <Button
          label="Справка (help)"
          icon="pi pi-question-circle"
          size="small"
          severity={active === "help" ? undefined : "secondary"}
          outlined={active !== "help"}
          disabled={!hasHelp}
          onClick={() => load("help")}
        />
        {doc && <span className="stat-pill">источник: {doc.source}</span>}
        {doc?.truncated && <span className="stat-pill">обрезано</span>}
      </div>
      {loading && <div>Загрузка…</div>}
      {error && <div style={{ color: "var(--red-500, #ef4444)" }}>{error}</div>}
      {doc && !loading && (
        <pre
          style={{
            margin: 0,
            padding: "0.85rem 1rem",
            background: "var(--surface-100, #f1f5f9)",
            borderRadius: 8,
            fontSize: "0.82rem",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: "28rem",
            overflow: "auto",
          }}
        >
          {doc.text}
        </pre>
      )}
      {!active && !loading && (
        <div style={{ color: "var(--text-color-secondary, #64748b)", fontSize: "0.88rem" }}>
          {hasMan ? "Выберите источник: man-страница или вывод справки." : "Man-страница не найдена, доступна справка."}
        </div>
      )}
    </div>
  );
}

export function CommandDetailPage({ id }: { id: number }): React.ReactElement {
  const { data, error, loading } = useAsync<CommandDetail>(() => api.command(id), [id]);

  if (loading || error || !data) {
    return (
      <>
        <BackButton tab="commands" />
        <LoadingBlock loading={loading} error={error ?? (data ? null : "Не найдено")} />
      </>
    );
  }

  return (
    <div>
      <BackButton tab="commands" />
      <div className="detail-header">
        <div>
          <h2 style={{ margin: "0 0 0.35rem" }}>
            {data.name} <Tag value={data.kind} severity={data.kind === "exec" ? "info" : "secondary"} />
          </h2>
          <div className="chip-row">
            <span className="stat-pill">{data.source}</span>
            {data.packageName && <span className="stat-pill">{data.packageName}</span>}
            {data.processCount > 0 && <span className="stat-pill">процессов: {data.processCount}</span>}
          </div>
        </div>
      </div>

      {data.doc?.summary && (
        <div className="detail-section">
          <h3>Описание</h3>
          <p style={{ margin: 0 }}>{data.doc.summary}</p>
        </div>
      )}

      <div className="detail-section">
        <h3>Расположение</h3>
        <dl className="kv">
          <dt>Пути</dt>
          <dd>
            {data.paths.length > 0 ? (
              data.paths.map((p) => (
                <div key={p}>
                  {p}
                  {p === data.realPath && <span style={{ color: "var(--text-color-secondary)" }}> (real)</span>}
                </div>
              ))
            ) : (
              "—"
            )}
          </dd>
          {data.names.filter((n) => n !== data.name).length > 0 && (
            <>
              <dt>Имена</dt>
              <dd>{data.names.filter((n) => n !== data.name).join(", ")}</dd>
            </>
          )}
          {data.aliases.length > 0 && (
            <>
              <dt>Алиасы</dt>
              <dd>
                {data.aliases.map((a) => (
                  <div key={a}>{a}</div>
                ))}
              </dd>
            </>
          )}
          {data.doc?.manPath && (
            <>
              <dt>Man-страница</dt>
              <dd>
                {data.doc.manPath} (секция {data.doc.manSection || "?"})
              </dd>
            </>
          )}
          {data.doc && (
            <>
              <dt>Источник doc</dt>
              <dd>
                {data.doc.source}
                {data.doc.helpFlag ? ` (${data.doc.helpFlag})` : ""}
              </dd>
            </>
          )}
        </dl>
      </div>

      <DocViewer command={data} />

      {data.desktopEntries.length > 0 && (
        <div className="detail-section">
          <h3>Ярлыки</h3>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {data.desktopEntries.map((d) => (
              <li key={d.id}>
                {d.name} <span style={{ color: "var(--text-color-secondary)" }}>({d.filePath})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.processes.length > 0 && (
        <div className="detail-section">
          <h3>Процессы ({data.processes.length})</h3>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {data.processes.map((p) => (
              <li key={p.id}>
                {p.pid} — {p.cmdline || "(kernel)"}{" "}
                <span style={{ color: "var(--text-color-secondary)" }}>
                  {p.uptimeSec != null ? `${p.uptimeSec} с` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
