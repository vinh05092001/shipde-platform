export interface VerificationMessage {
  channel: 'email' | 'phone';
  recipient: string;
  token?: string;
  otp?: string;
  sentAt: Date;
}

export interface IVerificationDeliveryAdapter {
  sendVerification(
    message: Omit<VerificationMessage, 'sentAt'>
  ): Promise<{ success: boolean; messageId: string }>;
}

export class MockVerificationDeliveryAdapter implements IVerificationDeliveryAdapter {
  private sentMessages: VerificationMessage[] = [];
  private shouldFail = false;
  private failureReason = 'Delivery service unavailable';

  async sendVerification(
    message: Omit<VerificationMessage, 'sentAt'>
  ): Promise<{ success: boolean; messageId: string }> {
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }
    const record: VerificationMessage = {
      ...message,
      sentAt: new Date(),
    };
    this.sentMessages.push(record);
    return {
      success: true,
      messageId: `mock-msg-${this.sentMessages.length}`,
    };
  }

  getSentMessages(): VerificationMessage[] {
    return [...this.sentMessages];
  }

  getLastMessage(): VerificationMessage | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  findMessagesByRecipient(recipient: string): VerificationMessage[] {
    return this.sentMessages.filter((m) => m.recipient === recipient);
  }

  setFailureMode(fail: boolean, reason = 'Delivery service unavailable'): void {
    this.shouldFail = fail;
    this.failureReason = reason;
  }

  clear(): void {
    this.sentMessages = [];
    this.shouldFail = false;
  }
}

export const globalMockVerificationAdapter = new MockVerificationDeliveryAdapter();
