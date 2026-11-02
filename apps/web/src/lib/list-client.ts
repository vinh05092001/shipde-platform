import { parseListQuery, type ListMetadata, type ListPolicy } from './list-contract';

export type ListResource = 'users' | 'branches' | 'warehouses';

export interface ResourceListQuery {
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search: string;
  status: string;
  role?: string;
}

export function defaultResourceQuery(policy: ListPolicy): ResourceListQuery {
  return {
    page: policy.defaultPage,
    limit: policy.defaultSize,
    sortBy: policy.defaultSort,
    sortOrder: policy.defaultDirection,
    search: '',
    status: 'ALL',
  };
}

export function buildListUrl(
  baseUrl: string,
  resource: ListResource,
  query: ResourceListQuery,
  policy: ListPolicy
): string {
  const values: Record<string, unknown> = {
    [policy.pageKey]: query.page,
    [policy.sizeKey]: query.limit,
    sort_by: query.sortBy,
    sort_order: query.sortOrder,
  };
  for (const field of Object.keys(policy.filters)) {
    const value = query[field as keyof ResourceListQuery];
    if (typeof value === 'string' && value.trim() && value !== 'ALL') values[field] = value.trim();
  }
  parseListQuery(values, policy);
  const url = new URL(`/api/v1/${resource}`, baseUrl);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
  return url.toString();
}

export class ListReadError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Keep rows and metadata from the same response; malformed responses are errors, never empty success. */
export function readListResponse<T>(
  body: unknown,
  resource: ListResource
): { rows: T[]; meta: ListMetadata; canEdit?: boolean } {
  const invalid = () => new ListReadError(503, 'Dữ liệu danh sách không hợp lệ. Vui lòng thử lại.');
  if (!isRecord(body) || body.success === false) throw invalid();
  const data = body.data;
  const rows = resource === 'branches' && isRecord(data) ? data.branches : data;
  const meta = resource === 'branches' && isRecord(data) ? (data.meta ?? body.meta) : body.meta;
  if (!Array.isArray(rows) || !isRecord(meta)) throw invalid();
  for (const field of ['page', 'limit', 'total', 'total_pages']) {
    const value = meta[field];
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < (field === 'total' ? 0 : 1)
    )
      throw invalid();
  }
  if (
    typeof meta.correlation_id !== 'string' ||
    rows.length > (meta.limit as number) ||
    meta.total_pages !== Math.max(1, Math.ceil((meta.total as number) / (meta.limit as number)))
  )
    throw invalid();
  return {
    rows: rows as T[],
    meta: meta as unknown as ListMetadata,
    canEdit: resource === 'branches' && isRecord(data) ? data.can_edit === true : undefined,
  };
}

export async function fetchListPage<T>(options: {
  baseUrl: string;
  resource: ListResource;
  query: ResourceListQuery;
  policy: ListPolicy;
  token: string;
  signal?: AbortSignal;
}): Promise<{ rows: T[]; meta: ListMetadata; canEdit?: boolean }> {
  const response = await fetch(
    buildListUrl(options.baseUrl, options.resource, options.query, options.policy),
    {
      headers: { Authorization: `Bearer ${options.token}` },
      signal: options.signal,
    }
  );
  if (!response.ok) {
    throw new ListReadError(
      response.status,
      response.status === 401
        ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
        : response.status === 403
          ? 'Bạn không có quyền truy cập danh sách này.'
          : 'Không thể tải danh sách. Vui lòng thử lại.'
    );
  }
  return readListResponse<T>(await response.json(), options.resource);
}

/** Scope pickers need every authorized option, independently of the visible list page. */
export async function fetchListOptions<T>(
  options: Omit<Parameters<typeof fetchListPage<T>>[0], 'query'>
): Promise<T[]> {
  const query = { ...defaultResourceQuery(options.policy), limit: options.policy.maxSize };
  const rows: T[] = [];
  let totalPages = 1;
  do {
    const result = await fetchListPage<T>({ ...options, query });
    rows.push(...result.rows);
    totalPages = result.meta.total_pages;
    query.page++;
  } while (query.page <= totalPages);
  return rows;
}
