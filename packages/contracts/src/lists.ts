/** Endpoint policy is explicit configuration, never inferred from request fields. */
export interface ListPolicy {
  pageKey: string;
  sizeKey: string;
  defaultPage: number;
  defaultSize: number;
  maxSize: number;
  sortFields: readonly string[];
  defaultSort: string;
  defaultDirection: 'asc' | 'desc';
  tieBreaker: string;
  filters: Readonly<Record<string, readonly string[] | null>>;
}

export interface ListQuery {
  [key: string]: unknown;
}

export interface ListMetadata {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  correlation_id: string;
}

export interface ListResponse<T> {
  data: T[];
  meta: ListMetadata;
}

export class ListContractError extends Error {
  constructor(public readonly code: 'VALIDATION_ERROR' | 'CONFIGURATION_ERROR') {
    super(code === 'VALIDATION_ERROR' ? 'Invalid list query' : 'Invalid list configuration');
  }
}

function positiveInteger(value: unknown): number {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^[0-9]+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  ) {
    throw new ListContractError('VALIDATION_ERROR');
  }
  return Number(value);
}

export function parseListQuery(query: ListQuery, policy: ListPolicy) {
  try {
    if (
      !policy ||
      ![policy.pageKey, policy.sizeKey, policy.defaultSort, policy.tieBreaker].every(
        (key) => typeof key === 'string' && key.length > 0
      ) ||
      !Array.isArray(policy.sortFields) ||
      !policy.sortFields.every((field) => typeof field === 'string' && field.length > 0) ||
      !policy.sortFields.includes(policy.defaultSort) ||
      !policy.sortFields.includes(policy.tieBreaker) ||
      !['asc', 'desc'].includes(policy.defaultDirection) ||
      !policy.filters ||
      typeof policy.filters !== 'object' ||
      Array.isArray(policy.filters)
    )
      throw new Error();
    for (const value of [policy.defaultPage, policy.defaultSize, policy.maxSize]) {
      if (typeof value !== 'number') throw new Error();
      positiveInteger(value);
    }
    if (policy.defaultSize > policy.maxSize) throw new Error();
    const keys = [
      policy.pageKey,
      policy.sizeKey,
      'sort_by',
      'sort_order',
      ...Object.keys(policy.filters),
    ];
    if (new Set(keys).size !== keys.length) throw new Error();
    for (const values of Object.values(policy.filters)) {
      if (
        values !== null &&
        (!Array.isArray(values) ||
          !values.length ||
          !values.every((v) => typeof v === 'string' && v.length > 0))
      )
        throw new Error();
    }
  } catch {
    throw new ListContractError('CONFIGURATION_ERROR');
  }
  const allowed = new Set([
    policy.pageKey,
    policy.sizeKey,
    'sort_by',
    'sort_order',
    ...Object.keys(policy.filters),
  ]);
  if (
    !query ||
    typeof query !== 'object' ||
    Array.isArray(query) ||
    Object.keys(query).some((key) => !allowed.has(key))
  ) {
    throw new ListContractError('VALIDATION_ERROR');
  }
  const page = positiveInteger(
    query[policy.pageKey] === undefined ? policy.defaultPage : query[policy.pageKey]
  );
  // Preserve the existing users family's documented maximum/clamping behaviour.
  const limit = Math.min(
    positiveInteger(
      query[policy.sizeKey] === undefined ? policy.defaultSize : query[policy.sizeKey]
    ),
    policy.maxSize
  );
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip) || !Number.isSafeInteger(skip + limit))
    throw new ListContractError('VALIDATION_ERROR');
  const sortBy = query.sort_by === undefined ? policy.defaultSort : query.sort_by;
  const direction = query.sort_order === undefined ? policy.defaultDirection : query.sort_order;
  if (
    typeof sortBy !== 'string' ||
    !policy.sortFields.includes(sortBy) ||
    (direction !== 'asc' && direction !== 'desc')
  )
    throw new ListContractError('VALIDATION_ERROR');
  const filters: Record<string, string> = {};
  for (const [key, values] of Object.entries(policy.filters)) {
    const value = query[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || (values !== null && !values.includes(value)))
      throw new ListContractError('VALIDATION_ERROR');
    filters[key] = value.trim();
  }
  const orderBy: Record<string, 'asc' | 'desc'>[] = [{ [sortBy]: direction }];
  if (sortBy !== policy.tieBreaker) orderBy.push({ [policy.tieBreaker]: direction });
  return { page, limit, skip, filters, orderBy };
}
