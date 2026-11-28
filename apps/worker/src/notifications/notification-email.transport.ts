import { Injectable, Inject } from '@nestjs/common';
import { AppConfig, resolveNotificationDeliveryConfig } from '@shipde/config';
import { NotificationDeliveryState } from '@shipde/contracts';
import { APP_CONFIG } from '../config.token';

export interface NotificationEmailDispatchInput {
  to: string;
  subject: string;
  body: string;
  submissionId: string;
  correlationId: string;
}

export interface NotificationEmailDispatchResult {
  outcome: Extract<NotificationDeliveryState, 'SENT' | 'FAILED' | 'UNKNOWN' | 'NOT_CONFIGURED'>;
  providerMessageId?: string | null;
  errorCode?: string | null;
}

export interface INotificationEmailTransport {
  send(input: NotificationEmailDispatchInput): Promise<NotificationEmailDispatchResult>;
}

export const NOTIFICATION_EMAIL_TRANSPORT = 'NOTIFICATION_EMAIL_TRANSPORT';

/**
 * FEAT-COM-09 D5 — Dedicated Worker Notification Mail Adapter.
 * Explicitly NEVER reuses apps/api/src/auth/default-verification-adapter.ts.
 * Missing provider configuration returns truthful NOT_CONFIGURED (never simulated success).
 */
@Injectable()
export class NotificationEmailTransport implements INotificationEmailTransport {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async send(_input: NotificationEmailDispatchInput): Promise<NotificationEmailDispatchResult> {
    const deliveryCfg = resolveNotificationDeliveryConfig(this.config);
    if (deliveryCfg.emailProviderMode === 'unconfigured') {
      return {
        outcome: 'NOT_CONFIGURED',
        providerMessageId: null,
        errorCode: 'EMAIL_PROVIDER_NOT_CONFIGURED',
      };
    }
    // Live SMTP transport requires operator-provisioned SMTP runtime credentials;
    // fail truthfully when unprovisioned rather than simulating delivery.
    return {
      outcome: 'NOT_CONFIGURED',
      providerMessageId: null,
      errorCode: 'SMTP_TRANSPORT_UNPROVISIONED',
    };
  }
}
