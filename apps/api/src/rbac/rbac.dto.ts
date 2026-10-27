export interface CreateRoleDto {
  name: string;
  description?: string;
  permissions: string[];
}

export interface UpdateRoleDto {
  name?: string;
  description?: string;
  permissions?: string[];
}

export interface ActorContext {
  userId: string;
  merchantId: string;
  role?: string;
  customRoleId?: string | null;
  authAssurance?: string;
  mfaVerifiedAt?: Date | string | null;
}
