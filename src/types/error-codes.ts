// ============================================================================
// Ship Dễ — Standard Error Code Catalog (Tập 2 Mục 2)
// Chuẩn hóa mã lỗi HTTP và error.code ổn định giữa các phiên bản
// ============================================================================

export interface ShipDeErrorDetail {
  code: string;
  message: string;
  message_en: string;
  details?: Record<string, unknown>;
  httpStatus: number;
}

export const ERROR_CATALOG = {
  // 400 Bad Request
  VALIDATION_ERROR: {
    code: 'validation_error',
    message: 'Dữ liệu không đạt ràng buộc kiểm tra hợp lệ.',
    message_en: 'Validation error: payload constraints failed.',
    httpStatus: 400,
  },

  // 401 Unauthorized
  AUTHENTICATION_REQUIRED: {
    code: 'authentication_required',
    message: 'Thiếu hoặc hết hạn thông tin xác thực.',
    message_en: 'Authentication required or session expired.',
    httpStatus: 401,
  },
  CARRIER_AUTH_FAILED: {
    code: 'carrier_auth_failed',
    message: 'Thông tin xác thực (token/credential) hãng vận chuyển không hợp lệ hoặc đã hết hạn.',
    message_en: 'Carrier credential invalid or expired.',
    httpStatus: 401,
  },
  DEVICE_REVOKED: {
    code: 'device_revoked',
    message: 'Thiết bị hoặc phiên đăng nhập ứng dụng đã bị thu hồi từ xa.',
    message_en: 'Device or app session has been revoked remotely.',
    httpStatus: 401,
  },

  // 403 Forbidden
  FORBIDDEN: {
    code: 'forbidden',
    message: 'Bạn không có quyền thực hiện thao tác này.',
    message_en: 'Forbidden: insufficient permissions.',
    httpStatus: 403,
  },
  OUT_OF_SCOPE: {
    code: 'out_of_scope',
    message: 'Bản ghi nằm ngoài phạm vi kho hoặc chi nhánh được phân công.',
    message_en: 'Record is out of assigned warehouse or store scope.',
    httpStatus: 403,
  },
  SELF_APPROVAL_FORBIDDEN: {
    code: 'self_approval_forbidden',
    message:
      'Quy tắc tách quyền tài chính (BR-12): Người tạo hoặc xử lý vận đơn không được tự duyệt chênh lệch của chính đơn đó.',
    message_en:
      'Maker-checker violation: You cannot approve discrepancies on orders you created or modified.',
    httpStatus: 403,
  },
  PRIVILEGE_ESCALATION: {
    code: 'privilege_escalation',
    message: 'Không thể gán quyền cao hơn quyền hạn hiện tại của bạn.',
    message_en: 'Cannot grant privileges higher than your own.',
    httpStatus: 403,
  },

  // 404 Not Found
  RESOURCE_NOT_FOUND: {
    code: 'resource_not_found',
    message: 'Không tìm thấy dữ liệu trong phạm vi merchant.',
    message_en: 'Resource not found.',
    httpStatus: 404,
  },
  BARCODE_UNKNOWN: {
    code: 'barcode_unknown',
    message: 'Mã vạch quét chưa được liên kết với kiện hàng nào.',
    message_en: 'Scanned barcode is not mapped to any known shipment.',
    httpStatus: 404,
  },

  // 409 Conflict
  VERSION_CONFLICT: {
    code: 'version_conflict',
    message: 'Dữ liệu đã được người khác cập nhật trước đó (xung đột phiên bản khóa lạc quan).',
    message_en: 'Optimistic locking conflict: data has been modified by another user.',
    httpStatus: 409,
  },
  ORDER_DUPLICATE: {
    code: 'order_duplicate',
    message: 'Mã đơn hàng đã tồn tại trong hệ thống với thông tin khác biệt.',
    message_en: 'Order duplicate detected with conflicting payload.',
    httpStatus: 409,
  },
  CASE_ALREADY_OPEN: {
    code: 'case_already_open',
    message: 'Đã tồn tại một hồ sơ ngoại lệ đang mở cho cùng loại sự cố trên vận đơn này (BR-31).',
    message_en: 'An open exception case of this type already exists for this shipment.',
    httpStatus: 409,
  },
  REATTEMPT_IN_PROGRESS: {
    code: 'reattempt_in_progress',
    message: 'Đã có yêu cầu giao lại đang được xử lý cho vận đơn này (BR-33).',
    message_en: 'A reattempt request is already in progress for this shipment.',
    httpStatus: 409,
  },
  RETURN_ALREADY_RECEIVED: {
    code: 'return_already_received',
    message: 'Kiện hàng này đã được xác nhận nhập kho hoàn trước đó (BR-35).',
    message_en: 'Return package has already been received into warehouse.',
    httpStatus: 409,
  },
  STATEMENT_DUPLICATE: {
    code: 'statement_duplicate',
    message: 'File sao kê này đã được tải lên trước đó (trùng mã checksum SHA-256).',
    message_en: 'Duplicate statement file: matching SHA-256 checksum already exists.',
    httpStatus: 409,
  },
  UNRESOLVED_DISCREPANCIES: {
    code: 'unresolved_discrepancies',
    message: 'Không thể chốt kỳ đối soát vì vẫn còn các khoản chênh lệch chưa được xử lý (BR-11).',
    message_en: 'Cannot close period: unresolved discrepancies remain.',
    httpStatus: 409,
  },
  PERIOD_CLOSED: {
    code: 'period_closed',
    message: 'Kỳ đối soát đã chốt là bất biến và không thể sửa đổi hoặc tải đè sao kê (BR-11).',
    message_en: 'Reconciliation period is closed and immutable.',
    httpStatus: 409,
  },

  // 422 Unprocessable Entity
  IDEMPOTENCY_CONFLICT: {
    code: 'idempotency_conflict',
    message: 'Trùng Idempotency Key nhưng nội dung yêu cầu gửi lên khác với ban đầu (BR-01).',
    message_en: 'Idempotency conflict: same key with different payload.',
    httpStatus: 422,
  },
  REASON_REQUIRED: {
    code: 'reason_required',
    message: 'Thao tác nhạy cảm bắt buộc phải nhập lý do cụ thể (BR-22).',
    message_en: 'A non-empty reason is required for this action.',
    httpStatus: 422,
  },
  EVIDENCE_REQUIRED: {
    code: 'evidence_required',
    message: 'Bắt buộc đính kèm bằng chứng ảnh/video khi ghi nhận kiện hàng có vấn đề (BR-36).',
    message_en: 'Evidence (photo/video) is strictly required for abnormal condition.',
    httpStatus: 422,
  },
  RECONCILIATION_AMBIGUOUS: {
    code: 'reconciliation_ambiguous',
    message: 'Dòng sao kê có nhiều ứng viên trùng khớp, chuyển vào hàng đợi xử lý thủ công.',
    message_en: 'Ambiguous match: multiple candidates found for statement row.',
    httpStatus: 422,
  },
  CLAIM_DEADLINE_PASSED: {
    code: 'claim_deadline_passed',
    message: 'Đã quá thời hiệu khiếu nại theo chính sách của hãng vận chuyển (BR-48).',
    message_en: 'Claim deadline has expired per carrier policy.',
    httpStatus: 422,
  },
  REATTEMPT_WINDOW_CLOSED: {
    code: 'reattempt_window_closed',
    message: 'Đã quá cửa sổ thời gian cho phép hẹn giao lại hoặc đã vượt quá số lần tối đa.',
    message_en: 'Reattempt window is closed or max retry attempts exceeded.',
    httpStatus: 422,
  },

  // 426 Upgrade Required
  APP_UPGRADE_REQUIRED: {
    code: 'app_upgrade_required',
    message: 'Phiên bản ứng dụng di động đã cũ và không còn tương thích. Vui lòng cập nhật.',
    message_en: 'App version is obsolete. Please update to latest version.',
    httpStatus: 426,
  },

  // 429 Too Many Requests
  RATE_LIMIT_EXCEEDED: {
    code: 'rate_limit_exceeded',
    message:
      'Đã vượt quá giới hạn tần suất yêu cầu (Rate Limit ba tầng: Merchant, Carrier, Endpoint).',
    message_en: 'Rate limit exceeded.',
    httpStatus: 429,
  },

  // 501 Not Implemented
  CARRIER_OPERATION_UNSUPPORTED: {
    code: 'carrier_operation_unsupported',
    message: 'Hãng vận chuyển đang ở mức năng lực thấp hơn thao tác yêu cầu (BR-26).',
    message_en: 'Operation not supported by carrier tier (e.g. L1 vs L2).',
    httpStatus: 501,
  },

  // 503 Service Unavailable
  CARRIER_UNAVAILABLE: {
    code: 'carrier_unavailable',
    message:
      'Hệ thống đối tác vận chuyển tạm thời gián đoạn. Đã kích hoạt cơ chế cô lập lỗi (NFR-06).',
    message_en: 'Carrier API temporarily unavailable.',
    httpStatus: 503,
  },

  // 504 Gateway Timeout
  CARRIER_TIMEOUT: {
    code: 'carrier_timeout',
    message: 'Hãng vận chuyển không phản hồi trong thời gian chờ (Timeout đôi BR-16).',
    message_en: 'Carrier API timed out.',
    httpStatus: 504,
  },

  // 202 Accepted (Asynchronous Processing / Unknown Result)
  CARRIER_RESULT_UNKNOWN: {
    code: 'carrier_result_unknown',
    message:
      'Đã gửi yêu cầu tới hãng nhưng chưa rõ kết quả tức thì. Hệ thống sẽ đối soát qua mã tham chiếu.',
    message_en: 'Carrier request sent, result pending reconciliation.',
    httpStatus: 202,
  },
} as const;

export class ShipDeAppError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly messageEn: string;
  public readonly details?: Record<string, unknown>;

  constructor(errorDef: ShipDeErrorDetail, details?: Record<string, unknown>) {
    super(errorDef.message);
    this.code = errorDef.code;
    this.httpStatus = errorDef.httpStatus;
    this.messageEn = errorDef.message_en;
    this.details = details || errorDef.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toResponse(requestId: string = `req_${Date.now()}`) {
    return {
      error: {
        code: this.code,
        message: this.message,
        message_en: this.messageEn,
        details: this.details,
      },
      request_id: requestId,
    };
  }
}
