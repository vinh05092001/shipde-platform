/** FEAT-COM-02: users family policy; pagination and enums follow GET /users in OpenAPI. */
export const USERS_LIST_POLICY = {
  pageKey: 'page',
  sizeKey: 'limit',
  defaultPage: 1,
  defaultSize: 20,
  maxSize: 100,
  sortFields: ['created_at', 'full_name', 'id'],
  defaultSort: 'created_at',
  defaultDirection: 'desc',
  tieBreaker: 'id',
  filters: {
    role: ['OWNER', 'OPS_CSKH', 'WAREHOUSE', 'ACCOUNTANT', 'FINANCE'],
    status: ['ACTIVE', 'SUSPENDED', 'DISABLED', 'PENDING_VERIFICATION', 'INVITED'],
    search: null,
  },
} as const;

/** FEAT-COM-02: warehouses list policy. */
export const WAREHOUSES_LIST_POLICY = {
  pageKey: 'page',
  sizeKey: 'limit',
  defaultPage: 1,
  defaultSize: 10,
  maxSize: 100,
  sortFields: ['created_at', 'name', 'code', 'id'],
  defaultSort: 'created_at',
  defaultDirection: 'desc',
  tieBreaker: 'id',
  filters: {
    status: ['active', 'inactive'],
    search: null,
  },
} as const;

/** FEAT-COM-02: branches list policy. */
export const BRANCHES_LIST_POLICY = {
  pageKey: 'page',
  sizeKey: 'limit',
  defaultPage: 1,
  defaultSize: 10,
  maxSize: 100,
  sortFields: ['created_at', 'name', 'code', 'id'],
  defaultSort: 'name',
  defaultDirection: 'asc',
  tieBreaker: 'id',
  filters: {
    status: ['ACTIVE', 'INACTIVE'],
    search: null,
  },
} as const;
