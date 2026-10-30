import { HttpStatus } from '@nestjs/common';
import { ListContractError, ListPolicy, ListQuery, parseListQuery } from '@shipde/contracts';
import { CanonicalApiException } from '../auth/auth.service';

/** Input must come from SessionGuard's authorized membership, never a query parameter. */
export function requireListTenant(merchantId: unknown): { merchant_id: string } {
  if (typeof merchantId !== 'string' || !merchantId.trim() || merchantId !== merchantId.trim()) {
    throw new CanonicalApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Không có quyền truy cập');
  }
  return { merchant_id: merchantId };
}

export function parseCanonicalListQuery(query: ListQuery, policy: ListPolicy) {
  try {
    return parseListQuery(query, policy);
  } catch (error) {
    if (!(error instanceof ListContractError)) throw error;
    const invalid = error.code === 'VALIDATION_ERROR';
    throw new CanonicalApiException(
      invalid ? HttpStatus.BAD_REQUEST : HttpStatus.SERVICE_UNAVAILABLE,
      invalid ? 'VALIDATION_ERROR' : 'TEMPORARILY_UNAVAILABLE',
      invalid ? 'Tham số danh sách không hợp lệ' : 'Danh sách tạm thời không khả dụng',
      !invalid
    );
  }
}
