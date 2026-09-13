export interface PageQuery {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const MAX_PAGE_SIZE = 100;

export function parsePage(query: Record<string, unknown> = {}): PageQuery {
  const rawPage = Number(query.page ?? 1);
  const rawSize = Number(query.pageSize ?? 20);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(Math.floor(rawSize), MAX_PAGE_SIZE) : 20;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paged<T>(items: T[], total: number, q: PageQuery): Paged<T> {
  return {
    items,
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / q.pageSize),
  };
}
