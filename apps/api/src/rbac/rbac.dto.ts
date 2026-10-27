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
  sessionId?: string;
  authAssurance?: string;
  mfaVerifiedAt?: Date | string | null;
}
