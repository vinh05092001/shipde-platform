export interface AdminCreateShopDto {
  merchant_name: string;
  full_name?: string;
  email?: string;
  phone?: string;
  password?: string;
}

export interface AdminListShopsQuery {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface AdminCreatedShopResult {
  merchant: {
    id: string;
    name: string;
    code: string;
    status: string;
    created_at: Date;
  };
  user: {
    id: string;
    merchant_id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    role: string;
    status: string;
    email_verified_at: Date | null;
    phone_verified_at: Date | null;
  };
  temporary_password?: string;
  password_is_temporary: boolean;
}
