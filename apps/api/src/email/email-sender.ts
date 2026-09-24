import { Resend } from 'resend';

import type { AppConfig } from '../config/env';

/**
 * Transactional email is behind an interface so Phase 2 can swap Resend for
 * Amazon SES without touching the onboarding flow, and so local development
 * never sends real mail.
 */

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  ok: boolean;
  providerMessageId: string | null;
  error: string | null;
}

export interface EmailSender {
  readonly driver: 'console' | 'resend';
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export class ConsoleEmailSender implements EmailSender {
  readonly driver = 'console' as const;

  constructor(private readonly logger: { info: (obj: unknown, msg?: string) => void }) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    // The full plain-text body is logged, not a truncated preview. With
    // EMAIL_DRIVER=console the log *is* the delivery mechanism: a magic-link URL or
    // an onboarding handover must be copyable from it, and a preview cut the link
    // off mid-token. This driver is opt-in and the operator is the intended
    // recipient, so there is no third party to leak to.
    this.logger.info(
      {
        to: message.to,
        subject: message.subject,
        attachments: message.attachments?.map((attachment) => attachment.filename) ?? [],
        body: message.text,
      },
      'email not sent (EMAIL_DRIVER=console) — full message body below',
    );

    return { ok: true, providerMessageId: `console-${Date.now()}`, error: null };
  }
}

export class ResendEmailSender implements EmailSender {
  readonly driver = 'resend' as const;

  private readonly client: Resend;

  constructor(
    private readonly config: { apiKey: string; from: string },
    private readonly logger: { warn: (obj: unknown, msg?: string) => void },
  ) {
    this.client = new Resend(config.apiKey);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const response = await this.client.emails.send({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(message.attachments
          ? {
              attachments: message.attachments.map((attachment) => ({
                filename: attachment.filename,
                content:
                  typeof attachment.content === 'string'
                    ? Buffer.from(attachment.content)
                    : attachment.content,
              })),
            }
          : {}),
      });

      if (response.error) {
        return { ok: false, providerMessageId: null, error: response.error.message };
      }

      return { ok: true, providerMessageId: response.data?.id ?? null, error: null };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unknown Resend failure';
      this.logger.warn({ err: messageText, to: message.to }, 'resend delivery failed');
      return { ok: false, providerMessageId: null, error: messageText };
    }
  }
}

export function createEmailSender(
  config: AppConfig,
  logger: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void },
): EmailSender {
  if (config.EMAIL_DRIVER === 'resend' && config.RESEND_API_KEY) {
    return new ResendEmailSender({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM }, logger);
  }
  return new ConsoleEmailSender(logger);
}
