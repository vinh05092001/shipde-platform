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
  store_scopes?: string[];
  warehouse_scopes?: string[];
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
