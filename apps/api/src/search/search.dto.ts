import type { CanonicalFieldError } from '../auth/auth.service';
import { SearchEntityType } from '@shipde/contracts';

export interface SearchQueryDto {
  q?: string;
  type?: string;
  limit?: string | number;
}

export interface ParsedSearchQuery {
  q: string;
  type: SearchEntityType;
  limit: number;
}

export const VALID_SEARCH_TYPES: ReadonlySet<string> = new Set(Object.values(SearchEntityType));

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const MIN_SEARCH_LIMIT = 1;
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

export function validateSearchQueryDto(query: SearchQueryDto): {
  errors: CanonicalFieldError[];
  parsed?: ParsedSearchQuery;
} {
  const errors: CanonicalFieldError[] = [];

  const rawQ = query?.q;
  if (!rawQ || typeof rawQ !== 'string' || rawQ.trim().length < MIN_QUERY_LENGTH) {
    errors.push({
      field: 'q',
      code: 'VALIDATION_ERROR',
      message: `Từ khóa tìm kiếm phải có ít nhất ${MIN_QUERY_LENGTH} ký tự`,
    });
  } else if (rawQ.trim().length > MAX_QUERY_LENGTH) {
    errors.push({
      field: 'q',
      code: 'VALIDATION_ERROR',
      message: `Từ khóa tìm kiếm không được vượt quá ${MAX_QUERY_LENGTH} ký tự`,
    });
  }

  const rawType = query?.type ? String(query.type).trim().toUpperCase() : SearchEntityType.ALL;
  if (!VALID_SEARCH_TYPES.has(rawType)) {
    errors.push({
      field: 'type',
      code: 'VALIDATION_ERROR',
      message: `Loại thực thể tìm kiếm không hợp lệ (hỗ trợ ${Array.from(VALID_SEARCH_TYPES).join(', ')})`,
    });
  }

  let limitNum = DEFAULT_SEARCH_LIMIT;
  if (query?.limit !== undefined && query?.limit !== null && query?.limit !== '') {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed < MIN_SEARCH_LIMIT || parsed > MAX_SEARCH_LIMIT) {
      errors.push({
        field: 'limit',
        code: 'VALIDATION_ERROR',
        message: `Số lượng kết quả (limit) phải là số nguyên từ ${MIN_SEARCH_LIMIT} đến ${MAX_SEARCH_LIMIT}`,
      });
    } else {
      limitNum = parsed;
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    errors: [],
    parsed: {
      q: (rawQ as string).trim(),
      type: rawType as SearchEntityType,
      limit: limitNum,
    },
  };
}
