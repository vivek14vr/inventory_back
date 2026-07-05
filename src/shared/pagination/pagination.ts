import type { PaginationQuery } from "./pagination.validation.js";

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  from: number;
  to: number;
};

export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number
): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * limit + 1;
  const to = total === 0 ? 0 : Math.min(safePage * limit, total);

  return {
    page: safePage,
    limit,
    total,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
    from,
    to,
  };
}

export function mongoSort(
  field: string,
  order: "asc" | "desc" = "desc"
): Record<string, 1 | -1> {
  return { [field]: order === "asc" ? 1 : -1 };
}

export function getPaginationParams(query: PaginationQuery) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;
  return { page, limit, skip, sortOrder: query.sortOrder ?? "desc" };
}

export function paginateArray<T>(
  items: T[],
  query: PaginationQuery
): { items: T[]; pagination: PaginationMeta } {
  const { page, limit } = getPaginationParams(query);
  const total = items.length;
  const pagination = buildPaginationMeta(total, page, limit);
  const safeSkip = (pagination.page - 1) * limit;
  return {
    items: items.slice(safeSkip, safeSkip + limit),
    pagination,
  };
}

export function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  sortBy: string | undefined,
  sortOrder: "asc" | "desc",
  fieldMap: Record<string, keyof T | ((row: T) => string | number)>
): T[] {
  if (!sortBy || !fieldMap[sortBy]) {
    return rows;
  }
  const resolver = fieldMap[sortBy];
  const dir = sortOrder === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av =
      typeof resolver === "function"
        ? resolver(a)
        : (a[resolver] as string | number);
    const bv =
      typeof resolver === "function"
        ? resolver(b)
        : (b[resolver] as string | number);
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * dir;
    }
    return String(av).localeCompare(String(bv)) * dir;
  });
}

export function filterBySearch<T>(
  rows: T[],
  search: string | undefined,
  fields: ((row: T) => string)[]
): T[] {
  const q = search?.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    fields.some((fn) => fn(row).toLowerCase().includes(q))
  );
}
