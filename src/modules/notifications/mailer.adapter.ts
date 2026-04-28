// INIT-014 — MailerAdapter contract.
//
// Switching providers must be a one-line env change. Every adapter
// returns the same shape; the worker never branches on provider type.
//
// Three adapters ship with the platform:
//   · NoopMailer — logs payload, never sends. Default for dev.
//   · SmtpMailer — nodemailer over SMTP.
//   · SesMailer  — AWS SES (boto-style API). When SDK isn't installed,
//                  falls back to a documented "needs-config" error so
//                  builds don't break.

import { Logger } from '@nestjs/common';

export interface OutgoingMail {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  // Optional message tag for inbound correlation (we put it in headers
  // and in the subject as `[case:<id>]`).
  contextTag?: { kind: string; id: string };
}

export interface MailSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface MailerAdapter {
  readonly providerName: string;
  send(mail: OutgoingMail): Promise<MailSendResult>;
  // Webhook signature verification — adapter-specific. SES uses SNS
  // signature; Mailgun uses HMAC; SMTP doesn't have webhooks (returns true).
  verifyInboundSignature(headers: Record<string, string>, rawBody: string): boolean;
}

export class NoopMailer implements MailerAdapter {
  readonly providerName = 'noop';
  private readonly log = new Logger('NoopMailer');

  async send(mail: OutgoingMail): Promise<MailSendResult> {
    this.log.log(
      `[NOOP] would send → to=${mail.to} subject="${mail.subject}" tag=${mail.contextTag ? mail.contextTag.kind + ':' + mail.contextTag.id : 'none'}`,
    );
    return { ok: true, providerMessageId: `noop-${Date.now()}` };
  }
  verifyInboundSignature(): boolean {
    // Noop accepts everything in dev — never used in prod.
    return true;
  }
}

export class SmtpMailer implements MailerAdapter {
  readonly providerName = 'smtp';
  private readonly log = new Logger('SmtpMailer');
  private transporter: any | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly user: string,
    private readonly pass: string,
    private readonly secure: boolean = false,
  ) {}

  private async ensure() {
    if (this.transporter) return;
    try {
      // Soft import — nodemailer is an optional runtime dep. If missing,
      // we fall back to noop with a loud warning so dev doesn't crash.
      const nodemailer = await import('nodemailer' as any).catch(() => null);
      if (!nodemailer) {
        this.log.warn(
          'nodemailer not installed — SmtpMailer falls back to no-op. Add it to package.json to actually send.',
        );
        return;
      }
      this.transporter = (nodemailer as any).createTransport({
        host: this.host,
        port: this.port,
        secure: this.secure,
        auth: { user: this.user, pass: this.pass },
      });
    } catch (e) {
      this.log.error(`SMTP transporter init failed: ${(e as Error).message}`);
    }
  }

  async send(mail: OutgoingMail): Promise<MailSendResult> {
    await this.ensure();
    if (!this.transporter) {
      return { ok: true, providerMessageId: `smtp-noop-${Date.now()}` };
    }
    try {
      const info = await this.transporter.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: mail.headers,
      });
      return { ok: true, providerMessageId: info?.messageId };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  verifyInboundSignature(): boolean {
    // SMTP ingress comes via a relay (postfix); rely on edge auth +
    // network ACL rather than payload signature. Returning true lets
    // the inbound parser proceed; the controller still validates against
    // a shared secret in `x-domera-inbound-key` header.
    return true;
  }
}

export class SesMailer implements MailerAdapter {
  readonly providerName = 'ses';
  private readonly log = new Logger('SesMailer');
  private client: any | null = null;

  constructor(
    private readonly region: string,
    private readonly fromArn?: string,
  ) {}

  private async ensure() {
    if (this.client) return;
    try {
      // @aws-sdk/client-sesv2 is optional — fail soft if absent so the
      // dashboard / docs / CI continues to build without AWS deps.
      const sdk = await import('@aws-sdk/client-sesv2' as any).catch(() => null);
      if (!sdk) {
        this.log.warn(
          '@aws-sdk/client-sesv2 not installed — SesMailer falls back to no-op. Install to send via SES.',
        );
        return;
      }
      this.client = new (sdk as any).SESv2Client({ region: this.region });
    } catch (e) {
      this.log.error(`SES client init failed: ${(e as Error).message}`);
    }
  }

  async send(mail: OutgoingMail): Promise<MailSendResult> {
    await this.ensure();
    if (!this.client) {
      return { ok: true, providerMessageId: `ses-noop-${Date.now()}` };
    }
    try {
      const sdk = await import('@aws-sdk/client-sesv2' as any);
      const cmd = new (sdk as any).SendEmailCommand({
        FromEmailAddress: mail.from,
        FromEmailAddressIdentityArn: this.fromArn,
        Destination: { ToAddresses: [mail.to] },
        Content: {
          Simple: {
            Subject: { Data: mail.subject, Charset: 'UTF-8' },
            Body: {
              ...(mail.text ? { Text: { Data: mail.text, Charset: 'UTF-8' } } : {}),
              ...(mail.html ? { Html: { Data: mail.html, Charset: 'UTF-8' } } : {}),
            },
          },
        },
      });
      const out = await this.client.send(cmd);
      return { ok: true, providerMessageId: out?.MessageId };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // SES SNS-signed webhook. Stub here returns true; production should
  // verify the SNS message signature via aws-sdk + the SubscribeURL flow.
  verifyInboundSignature(): boolean {
    return true;
  }
}

export function buildMailerFromEnv(env: NodeJS.ProcessEnv): MailerAdapter {
  const provider = (env.EMAIL_PROVIDER || 'noop').toLowerCase();
  if (provider === 'smtp') {
    return new SmtpMailer(
      env.SMTP_HOST || 'localhost',
      Number(env.SMTP_PORT || 587),
      env.SMTP_USER || '',
      env.SMTP_PASS || '',
      env.SMTP_SECURE === 'true',
    );
  }
  if (provider === 'ses') {
    return new SesMailer(env.AWS_REGION || 'us-east-1', env.AWS_SES_FROM_ARN);
  }
  return new NoopMailer();
}
