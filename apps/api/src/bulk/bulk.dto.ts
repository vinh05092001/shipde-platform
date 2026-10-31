import { HttpStatus } from '@nestjs/common';
import { BulkEntityType, BulkActionType, BulkActionRequest } from '@shipde/contracts';
import { CanonicalApiException } from '../auth/auth.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ValidatedBulkActionDto {
  entity_type: BulkEntityType;
  action: BulkActionType;
  ids: string[];
  params?: {
    store_scopes?: string[];
    warehouse_scopes?: string[];
    carrier_account_scopes?: string[];
    reason?: string;
    [key: string]: unknown;
  };
  confirm?: boolean;
  idempotency_key?: string;
}

/**
 * Validates bulk action input payload against canonical schema and business invariants.
 * Throws CanonicalApiException with 400 status on validation failure.
 */
export function validateBulkActionDto(input: unknown, maxItems: number): ValidatedBulkActionDto {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CanonicalApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      'Dữ liệu yêu cầu thực thi hàng loạt không hợp lệ',
      false,
      'Vui lòng cung cấp đối tượng JSON hợp lệ',
      [{ field: 'body', code: 'INVALID_OBJECT', message: 'Body must be a valid JSON object' }]
    );
  }

  const raw = input as Record<string, unknown>;
  const errors: { field: string; code: string; message: string }[] = [];

  // 1. entity_type validation
  if (!raw.entity_type || typeof raw.entity_type !== 'string') {
    errors.push({
      field: 'entity_type',
      code: 'REQUIRED',
      message: 'entity_type là trường bắt buộc',
    });
  } else {
    const et = raw.entity_type.trim().toLowerCase();
    const validEntities = Object.values(BulkEntityType);
    if (!validEntities.includes(et as BulkEntityType)) {
      if (['orders', 'shipments', 'carrier_accounts'].includes(et)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'UNSUPPORTED_BULK_ENTITY',
          'Thực thi hàng loạt cho đơn hàng và vận đơn chưa được hỗ trợ tại phiên bản này (yêu cầu quy trình phê duyệt và đối soát chuyên biệt)',
          false,
          'Chỉ hỗ trợ thực thi hàng loạt cho users, branches và warehouses'
        );
      }
      errors.push({
        field: 'entity_type',
        code: 'INVALID_ENTITY_TYPE',
        message: `entity_type phải là một trong: ${validEntities.join(', ')}`,
      });
    }
  }

  // 2. action validation
  if (!raw.action || typeof raw.action !== 'string') {
    errors.push({
      field: 'action',
      code: 'REQUIRED',
      message: 'action là trường bắt buộc',
    });
  } else {
    const act = raw.action.trim().toLowerCase();
    const validActions = Object.values(BulkActionType);
    if (!validActions.includes(act as BulkActionType)) {
      errors.push({
        field: 'action',
        code: 'INVALID_ACTION',
        message: `action phải là một trong: ${validActions.join(', ')}`,
      });
    } else if (act === BulkActionType.ASSIGN_SCOPES && raw.entity_type !== BulkEntityType.USERS) {
      errors.push({
        field: 'action',
        code: 'ACTION_NOT_SUPPORTED_FOR_ENTITY',
        message: 'Tác vụ assign_scopes chỉ áp dụng cho người dùng (users)',
      });
    }
  }

  // 3. ids array validation
  if (!raw.ids || !Array.isArray(raw.ids)) {
    errors.push({
      field: 'ids',
      code: 'INVALID_ARRAY',
      message: 'ids phải là một mảng các mã định danh UUID',
    });
  } else if (raw.ids.length === 0) {
    errors.push({
      field: 'ids',
      code: 'EMPTY_ID_LIST',
      message: 'Danh sách IDs không được để trống',
    });
  } else if (raw.ids.length > maxItems) {
    errors.push({
      field: 'ids',
      code: 'MAX_ITEMS_EXCEEDED',
      message: `Danh sách ID vượt quá giới hạn tối đa cho phép (${maxItems})`,
    });
  } else {
    for (let i = 0; i < raw.ids.length; i++) {
      const id = raw.ids[i];
      if (typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
        errors.push({
          field: `ids[${i}]`,
          code: 'INVALID_UUID',
          message: `ID tại vị trí ${i} không đúng định dạng UUID`,
        });
        break; // report first invalid uuid to keep payload concise
      }
    }
  }

  // 4. Confirmation requirement for destructive actions
  const normalizedAction = typeof raw.action === 'string' ? raw.action.trim().toLowerCase() : '';
  if (normalizedAction === BulkActionType.DEACTIVATE && raw.confirm !== true) {
    throw new CanonicalApiException(
      HttpStatus.BAD_REQUEST,
      'CONFIRMATION_REQUIRED',
      'Hành động này mang tính tạm ngưng/vô hiệu hóa diện rộng và yêu cầu xác nhận trước khi thực hiện (confirm: true)',
      false,
      'Vui lòng gửi kèm trường confirm: true để xác nhận thực thi'
    );
  }

  // 5. Params validation for assign_scopes
  let validatedParams: ValidatedBulkActionDto['params'] = undefined;
  if (raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)) {
    const paramsObj = raw.params as Record<string, unknown>;
    validatedParams = {};

    if (normalizedAction === BulkActionType.ASSIGN_SCOPES) {
      const hasStoreScopes = Array.isArray(paramsObj.store_scopes);
      const hasWarehouseScopes = Array.isArray(paramsObj.warehouse_scopes);
      const hasCarrierScopes = Array.isArray(paramsObj.carrier_account_scopes);

      if (!hasStoreScopes && !hasWarehouseScopes && !hasCarrierScopes) {
        errors.push({
          field: 'params',
          code: 'MISSING_SCOPES',
          message:
            'Tác vụ assign_scopes yêu cầu ít nhất một trong các mảng: store_scopes, warehouse_scopes hoặc carrier_account_scopes',
        });
      }

      if (hasStoreScopes) {
        validatedParams.store_scopes = (paramsObj.store_scopes as unknown[]).map((s) =>
          String(s).trim()
        );
      }
      if (hasWarehouseScopes) {
        validatedParams.warehouse_scopes = (paramsObj.warehouse_scopes as unknown[]).map((w) =>
          String(w).trim()
        );
      }
      if (hasCarrierScopes) {
        validatedParams.carrier_account_scopes = (
          paramsObj.carrier_account_scopes as unknown[]
        ).map((c) => String(c).trim());
      }
    }

    if (paramsObj.reason !== undefined) {
      if (typeof paramsObj.reason !== 'string') {
        errors.push({
          field: 'params.reason',
          code: 'INVALID_TYPE',
          message: 'Lý do (reason) phải là chuỗi ký tự',
        });
      } else if (paramsObj.reason.length > 500) {
        errors.push({
          field: 'params.reason',
          code: 'MAX_LENGTH_EXCEEDED',
          message: 'Lý do không được vượt quá 500 ký tự',
        });
      } else {
        validatedParams.reason = paramsObj.reason.trim();
      }
    }
  } else if (normalizedAction === BulkActionType.ASSIGN_SCOPES) {
    errors.push({
      field: 'params',
      code: 'REQUIRED',
      message:
        'Tác vụ assign_scopes yêu cầu đối tượng params chứa phạm vi chi nhánh hoặc kho hàng cần gán',
    });
  }

  // 6. Idempotency key validation
  let validatedIdempotencyKey: string | undefined = undefined;
  if (raw.idempotency_key !== undefined) {
    if (typeof raw.idempotency_key !== 'string') {
      errors.push({
        field: 'idempotency_key',
        code: 'INVALID_TYPE',
        message: 'idempotency_key phải là chuỗi ký tự',
      });
    } else {
      validatedIdempotencyKey = raw.idempotency_key.trim();
    }
  }

  if (errors.length > 0) {
    throw new CanonicalApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      'Dữ liệu yêu cầu thực thi hàng loạt không vượt qua kiểm tra tính hợp lệ',
      false,
      errors.map((e) => e.message).join('; '),
      errors
    );
  }

  return {
    entity_type: (raw.entity_type as string).trim().toLowerCase() as BulkEntityType,
    action: normalizedAction as BulkActionType,
    ids: (raw.ids as string[]).map((id) => id.trim()),
    params: validatedParams,
    confirm: raw.confirm === true,
    idempotency_key: validatedIdempotencyKey,
  };
}
