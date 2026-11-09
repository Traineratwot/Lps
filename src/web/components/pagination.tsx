import React from "react";
import { Paginator, type PaginatorPageChangeEvent } from "primereact/paginator";

export function Pager({
  total,
  page,
  pageSize,
  onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number, pageSize: number) => void;
}): React.ReactElement {
  return (
    <Paginator
      first={(page - 1) * pageSize}
      rows={pageSize}
      totalRecords={total}
      rowsPerPageOptions={[12, 24, 48, 96]}
      onPageChange={(e: PaginatorPageChangeEvent) => onPage(Math.floor(e.first / e.rows) + 1, e.rows)}
    />
  );
}
