import type { CanonicalFieldError } from '../auth/auth.service';
import {
  OnboardingStepId,
  OnboardingStepStatus,
  OnboardingOverallStatus,
  OnboardingStepDto,
  OnboardingStateResponseDto,
  CompleteStepDto,
  isValidTimeZone,
} from '@shipde/contracts';

export {
  OnboardingStepId,
  OnboardingStepStatus,
  OnboardingOverallStatus,
  OnboardingStepDto,
  OnboardingStateResponseDto,
  CompleteStepDto,
};

export interface StepDefinition {
  id: OnboardingStepId;
  order: number;
  title: string;
  description: string;
  required: boolean;
  prerequisites: OnboardingStepId[];
}

export const ONBOARDING_STEPS_CATALOG: readonly StepDefinition[] = [
  {
    id: OnboardingStepId.SHOP_PROFILE,
    order: 1,
    title: 'Hồ sơ shop & pháp lý',
    description:
      'Thiết lập thông tin thương hiệu, tên pháp nhân, mã số thuế và thông tin thanh toán/đối soát.',
    required: true,
    prerequisites: [],
  },
  {
    id: OnboardingStepId.WAREHOUSE,
    order: 2,
    title: 'Kho hàng & địa chỉ lấy hàng',
    description:
      'Thiết lập địa chỉ lấy hàng và hoàn hàng đầu tiên để bưu tá đối tác đến lấy bưu kiện.',
    required: true,
    prerequisites: [OnboardingStepId.SHOP_PROFILE],
  },
  {
    id: OnboardingStepId.INVITE_USERS,
    order: 3,
    title: 'Mời nhân viên & phân quyền',
    description:
      'Thêm thành viên vận hành vào shop và phân bổ vai trò, phạm vi chi nhánh hoặc kho hàng.',
    required: false,
    prerequisites: [],
  },
  {
    id: OnboardingStepId.CARRIER_ACCOUNT,
    order: 4,
    title: 'Kết nối tài khoản vận chuyển',
    description:
      'Liên kết tài khoản đối tác vận chuyển (GHN, GHTK, Viettel Post, J&T...) để tra cứu giá và tạo đơn.',
    required: true,
    prerequisites: [OnboardingStepId.SHOP_PROFILE],
  },
  {
    id: OnboardingStepId.OPERATING_DEFAULTS,
    order: 5,
    title: 'Cấu hình vận hành & thông báo',
    description:
      'Thiết lập người trả cước mặc định, đơn vị khối lượng, thông báo và ghi chú giao nhận.',
    required: false,
    prerequisites: [],
  },
  {
    id: OnboardingStepId.TEST_ORDER,
    order: 6,
    title: 'Tạo đơn & kiểm tra bảng giá thử nghiệm',
    description:
      'Mô phỏng tra cứu cước vận chuyển và kiểm tra khả năng phục vụ với đơn hàng thử nghiệm.',
    required: true,
    prerequisites: [
      OnboardingStepId.SHOP_PROFILE,
      OnboardingStepId.WAREHOUSE,
      OnboardingStepId.CARRIER_ACCOUNT,
    ],
  },
] as const;

export const VALID_STEP_IDS: readonly string[] = ONBOARDING_STEPS_CATALOG.map((s) => s.id);

const PHONE_REGEX = /^(0|\+84)[35789][0-9]{8}$/;

export interface WarehouseStepPayload {
  name: string;
  phone: string;
  address: string;
  province?: string;
  district?: string;
  ward?: string;
  is_default?: boolean;
}

export function validateStepData(
  stepId: OnboardingStepId,
  data?: Record<string, any>
): CanonicalFieldError[] {
  const fields: CanonicalFieldError[] = [];
  if (!data) return fields;

  if (stepId === OnboardingStepId.WAREHOUSE) {
    if (data.name !== undefined) {
      if (typeof data.name !== 'string' || data.name.trim().length < 2) {
        fields.push({
          field: 'name',
          code: 'INVALID_NAME',
          message: 'Tên kho hàng phải từ 2 ký tự trở lên',
        });
      }
    }
    if (data.phone !== undefined) {
      if (typeof data.phone !== 'string' || !PHONE_REGEX.test(data.phone.trim())) {
        fields.push({
          field: 'phone',
          code: 'INVALID_PHONE_FORMAT',
          message: 'Số điện thoại kho hàng không hợp lệ (định dạng 10 số di động VN)',
        });
      }
    }
    if (data.address !== undefined) {
      if (typeof data.address !== 'string' || data.address.trim().length < 3) {
        fields.push({
          field: 'address',
          code: 'INVALID_ADDRESS',
          message: 'Địa chỉ kho hàng phải từ 3 ký tự trở lên',
        });
      }
    }
  }

  if (stepId === OnboardingStepId.OPERATING_DEFAULTS) {
    if (data.default_fee_payer !== undefined) {
      if (!['SHOP', 'RECIPIENT'].includes(data.default_fee_payer)) {
        fields.push({
          field: 'default_fee_payer',
          code: 'INVALID_ENUM',
          message: 'Người trả phí chỉ nhận giá trị SHOP hoặc RECIPIENT',
        });
      }
    }
    if (data.default_weight_unit !== undefined) {
      if (!['g', 'kg'].includes(data.default_weight_unit)) {
        fields.push({
          field: 'default_weight_unit',
          code: 'INVALID_ENUM',
          message: 'Đơn vị khối lượng chỉ nhận giá trị g hoặc kg',
        });
      }
    }
    if (data.timezone !== undefined) {
      if (!isValidTimeZone(data.timezone)) {
        fields.push({
          field: 'timezone',
          code: 'INVALID_TIMEZONE',
          message: 'Múi giờ không được hỗ trợ',
        });
      }
    }
  }

  return fields;
}
