import { RoleEnum } from '@prisma/client';

export interface ListUsersQueryDto {
  page?: string | number;
  limit?: string | number;
  role?: string;
  status?: string;
  search?: string;
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
