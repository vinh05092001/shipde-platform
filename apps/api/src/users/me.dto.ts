export interface NotificationChannelsDto {
  email?: boolean;
  in_app?: boolean;
  push?: boolean;
}

export interface NotificationSubscriptionsDto {
  delivery_fail?: boolean;
  rate_discrepancy?: boolean;
  cod_overdue?: boolean;
  claim_deadline_warning?: boolean;
  abnormal_return?: boolean;
  security_alerts?: boolean;
  create_unknown?: boolean;
}

export interface NotificationPreferencesDto {
  channels?: NotificationChannelsDto;
  digest_window_minutes?: number;
  subscriptions?: NotificationSubscriptionsDto;
}

export interface UpdateMeDto {
  full_name?: string;
  phone?: string | null;
  avatar_url?: string | null;
  language?: string;
  timezone?: string;
  default_warehouse_id?: string | null;
  notification_preferences?: NotificationPreferencesDto;
  // Disallowed fields to test privilege escalation
  role?: any;
  custom_role_id?: any;
  merchant_id?: any;
  store_scopes?: any;
  warehouse_scopes?: any;
  status?: any;
}

export interface UpdatePreferencesDto {
  language?: string;
  timezone?: string;
  default_warehouse_id?: string | null;
  notification_preferences?: NotificationPreferencesDto;
}
