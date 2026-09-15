import { Injectable, Logger } from '@nestjs/common';
import type { IVerificationDeliveryAdapter, VerificationMessage } from '@shipde/contracts';

@Injectable()
export class DefaultVerificationAdapter implements IVerificationDeliveryAdapter {
  private readonly logger = new Logger(DefaultVerificationAdapter.name);

  async sendVerification(
    message: Omit<VerificationMessage, 'sentAt'>
  ): Promise<{ success: boolean; messageId: string }> {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      this.logger.warn(
        `[PRODUCTION] External SMS/Email provider not wired. Mock dispatch to ${message.recipient} on channel ${message.channel}.`
      );
    } else {
      this.logger.log(
        `[DEV/FALLBACK] Verification dispatch to ${message.recipient} via ${message.channel}. Token: ${message.token || 'N/A'}, OTP: ${message.otp || 'N/A'}`
      );
    }

    return {
      success: true,
      messageId: `default-dispatch-${Date.now()}`,
    };
  }
}
