import { RoleEnum } from '@prisma/client';
import type { ListQuery } from '@shipde/contracts';

export interface ListUsersQueryDto extends ListQuery {
  page?: string | number;
  limit?: string | number;
  role?: string;
  status?: string;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface UpdateUserDto {
  full_name?: string;
  role?: RoleEnum | string;
  custom_role_id?: string;
  store_scopes?: string[];
  warehouse_scopes?: string[];
  carrier_account_scopes?: string[];
}

export interface SuspendUserDto {
  reason: string;
}

export interface ActivateUserDto {
  reason?: string;
}

export interface DeactivateUserDto {
  reason?: string;
}
