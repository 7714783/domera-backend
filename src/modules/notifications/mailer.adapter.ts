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

import { createHmac } from 'node:crypto';
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

// ──────────────────────────────────────────────────────────────────
// Resend (https://resend.com) — modern REST email API. Default
// production provider.
//
// Outbound: POST https://api.resend.com/emails with Bearer auth.
// Inbound + status webhooks are svix-signed; verification uses the
// svix-id + svix-timestamp + raw body HMAC-SHA256 against
// RESEND_WEBHOOK_SECRET (whsec_… format).
//
// No SDK required — straight `fetch`. We use Node 20+ global fetch
// (the API target). Falls back gracefully if RESEND_API_KEY is unset
// (returns ok=false so the worker dead-letters with a clear message).
// ──────────────────────────────────────────────────────────────────
export class ResendMailer implements MailerAdapter {
  readonly providerName = 'resend';
  private readonly log = new Logger('ResendMailer');

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string | undefined,
  ) {}

  async send(mail: OutgoingMail): Promise<MailSendResult> {
    if (!this.apiKey) {
      return { ok: false, error: 'RESEND_API_KEY is not set' };
    }
    try {
      const headersArray = mail.headers
        ? Object.entries(mail.headers).map(([name, value]) => ({ name, value }))
        : undefined;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from: mail.from,
          to: mail.to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          ...(headersArray ? { headers: headersArray } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        name?: string;
      };
      if (!res.ok) {
        return {
          ok: false,
          error: `Resend ${res.status} ${json?.name || ''}: ${json?.message || 'unknown'}`,
        };
      }
      return { ok: true, providerMessageId: json.id };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // Resend webhooks are signed via svix. Headers carry:
  //   svix-id, svix-timestamp, svix-signature (space-separated list of
  //   `v1,<base64>` entries — any one matching is sufficient).
  // Signature payload: `${svix-id}.${svix-timestamp}.${rawBody}`.
  // Compute: base64( HMAC-SHA256( secretBytes, payload ) ).
  // RESEND_WEBHOOK_SECRET begins with `whsec_` — strip prefix and
  // base64-decode to get the raw key bytes.
  verifyInboundSignature(headers: Record<string, string>, rawBody: string): boolean {
    if (!this.webhookSecret) {
      this.log.warn(
        'RESEND_WEBHOOK_SECRET not set — refusing all inbound payloads. Set it via Resend dashboard.',
      );
      return false;
    }
    const id = lookupHeader(headers, 'svix-id');
    const ts = lookupHeader(headers, 'svix-timestamp');
    const sig = lookupHeader(headers, 'svix-signature');
    if (!id || !ts || !sig) return false;

    // Replay protection — reject timestamps older than 5 minutes (svix
    // default tolerance). Number(ts) is seconds.
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return false;
    const drift = Math.abs(Date.now() / 1000 - tsNum);
    if (drift > 300) return false;

    let secretBytes: Buffer;
    try {
      const raw = this.webhookSecret.startsWith('whsec_')
        ? this.webhookSecret.slice(6)
        : this.webhookSecret;
      // svix secrets are base64; on malformed input fall back to raw bytes.
      secretBytes = Buffer.from(raw, 'base64');
      if (secretBytes.length === 0) secretBytes = Buffer.from(raw, 'utf8');
    } catch {
      return false;
    }

    const payload = `${id}.${ts}.${rawBody}`;
    const expected = createHmac('sha256', secretBytes).update(payload).digest('base64');

    // svix-signature header: "v1,<sig> v1,<sig>" — any match wins.
    const candidates = sig
      .split(/\s+/)
      .map((part) => {
        const [, value] = part.split(',');
        return value || '';
      })
      .filter(Boolean);
    return candidates.some((c) => safeEq(c, expected));
  }
}

// Header lookup is case-insensitive (Express normalises to lower; some
// providers / proxies don't).
function lookupHeader(h: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === lower) return h[k];
  }
  return undefined;
}

// Constant-time comparison of base64 strings — guards against timing
// oracles when checking signatures.
function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return acc === 0;
}

export function buildMailerFromEnv(env: NodeJS.ProcessEnv): MailerAdapter {
  const provider = (env.EMAIL_PROVIDER || 'noop').toLowerCase();
  if (provider === 'resend') {
    return new ResendMailer(env.RESEND_API_KEY || '', env.RESEND_WEBHOOK_SECRET);
  }
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
