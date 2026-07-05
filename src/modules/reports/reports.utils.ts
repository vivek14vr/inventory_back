export function buildDateFilter(
  dateFrom?: string,
  dateTo?: string
): Record<string, Date> | undefined {
  if (!dateFrom && !dateTo) return undefined;
  const filter: Record<string, Date> = {};
  if (dateFrom) filter.$gte = new Date(dateFrom);
  if (dateTo) {
    const end = new Date(dateTo);
    if (!dateTo.includes("T")) {
      end.setHours(23, 59, 59, 999);
    }
    filter.$lte = end;
  }
  return filter;
}

export function toCsv(
  rows: Record<string, string | number>[],
  columns: { key: string; header: string }[]
): string {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = columns.map((c) => escape(c.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => escape(row[c.key] ?? "")).join(",")
  );
  return [header, ...lines].join("\n");
}
