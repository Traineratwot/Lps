import React from "react";
import { Button } from "primereact/button";
import { navigate, type Tab } from "../../router.ts";

export function BackButton({ tab }: { tab: Tab }): React.ReactElement {
  return (
    <button type="button" className="back-link" onClick={() => navigate({ tab, id: null } as never)}>
      <i className="pi pi-arrow-left" /> Назад к списку
    </button>
  );
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    setLoading(true);
    loader()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading };
}

export function LoadingBlock({ loading, error }: { loading: boolean; error: string | null }): React.ReactElement | null {
  if (loading) return <div className="flex justify-content-center py-5">Загрузка…</div>;
  if (error) return <div className="detail-section">Ошибка: {error}</div>;
  return null;
}

export { Button };
