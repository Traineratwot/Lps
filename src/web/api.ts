import type {
  CommandDetail,
  CommandRow,
  DesktopRow,
  DocText,
  ListResp,
  ProcessDetail,
  ProcessRow,
  ProgramCard,
  ProgramDetail,
  StatsResp,
} from "./types.ts";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${path}`);
  }
  return (await res.json()) as T;
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export const api = {
  stats: () => get<StatsResp>("/api/stats"),
  programs: (params: Record<string, string | number | boolean | undefined>) =>
    get<ListResp<ProgramCard>>(`/api/programs${qs(params)}`),
  program: (id: string) => get<ProgramDetail>(`/api/programs/${encodeURIComponent(id)}`),
  commands: (params: Record<string, string | number | boolean | undefined>) =>
    get<ListResp<CommandRow>>(`/api/commands${qs(params)}`),
  command: (id: number) => get<CommandDetail>(`/api/commands/${id}`),
  commandDoc: (id: number, kind: "man" | "help") =>
    get<DocText>(`/api/commands/${id}/doc?kind=${kind}`),
  processes: (params: Record<string, string | number | boolean | undefined>) =>
    get<ListResp<ProcessRow>>(`/api/processes${qs(params)}`),
  process: (id: number) => get<ProcessDetail>(`/api/processes/${id}`),
  desktop: (params: Record<string, string | number | boolean | undefined>) =>
    get<ListResp<DesktopRow>>(`/api/desktop${qs(params)}`),
};
