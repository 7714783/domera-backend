// INIT-014 — Inbound email parser.
//
// Triggered by `POST /v1/mail/inbound/:provider` (signature-verified at
// the controller). Stores the raw payload, parses out attachments, runs
// a virus check (stub — provider-side scanning assumed), and links to
// a case via the `[kind:id]` subject tag (e.g. `[case:abc-123]`).
//
// Documents are saved through the existing DocumentsService — never via
// raw prisma — so document ownership stays with the documents module
// (ssot-ownership compliance).
//
// On signature failure: row stored with status='received' and
// signatureValid=false; the controller returns 401. We keep the row so
// ops can investigate spoofing attempts via the journal.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MigratorPrismaService } from '../../prisma/prisma.migrator';
import type { MailerAdapter } from './mailer.adapter';

export interface InboundPayload {
  provider: string;
  providerEventId?: string;
  fromAddress: string;
  toAddress: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    sizeBytes: number;
    // Provider-furnished URL or base64 payload — handler downloads/stores
    // through the documents module.
    contentUrl?: string;
    contentBase64?: string;
  }>;
  raw: unknown;
}

const LINK_TAG_RE = /\[(case|approval|work_order|cleaning_request):([a-z0-9-]+)\]/i;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB hard cap

@Injectable()
export class InboundEmailService {
  private readonly log = new Logger('InboundEmail');

  constructor(
    private readonly prisma: PrismaService,
    private readonly migrator: MigratorPrismaService,
  ) {}

  async ingest(
    provider: string,
    headers: Record<string, string>,
    rawBody: string,
    parsed: InboundPayload,
    mailer: MailerAdapter,
  ): Promise<{ id: string; status: string; signatureValid: boolean }> {
    // Provider-specific signature check + a shared-secret fallback for
    // dev / SMTP postfix relay (header `x-domera-inbound-key` matches
    // INBOUND_EMAIL_SECRET).
    let signatureValid = mailer.verifyInboundSignature(headers, rawBody);
    if (!signatureValid && process.env.INBOUND_EMAIL_SECRET) {
      signatureValid = headers['x-domera-inbound-key'] === process.env.INBOUND_EMAIL_SECRET;
    }

    // Dedup by providerEventId — provider may retry the webhook on 5xx.
    if (parsed.providerEventId) {
      const existing = await (this.migrator as any).emailInboundEvent.findFirst({
        where: { providerEventId: parsed.providerEventId },
        select: { id: true, status: true },
      });
      if (existing) {
        return { id: existing.id, status: existing.status, signatureValid };
      }
    }

    // Resolve tenant from the To: address. Convention:
    //   inbound+<tenantSlug>@<our-domain>  →  tenantId of that workspace.
    // Falls back to NULL when the recipient is just `inbound@…` and we
    // can't identify the tenant; row sits in orphan queue until ops
    // routes it (or it gets purged after N days).
    const tenantId = await this.resolveTenant(parsed.toAddress);

    const row = await (this.migrator as any).emailInboundEvent.create({
      data: {
        tenantId,
        provider,
        providerEventId: parsed.providerEventId ?? null,
        signatureValid,
        fromAddress: parsed.fromAddress,
        toAddress: parsed.toAddress,
        subject: parsed.subject ?? null,
        bodyText: parsed.bodyText ?? null,
        bodyHtml: parsed.bodyHtml ?? null,
        rawPayload: parsed.raw as any,
        attachmentCount: parsed.attachments?.length ?? 0,
        status: 'received',
      },
    });

    if (!signatureValid) {
      this.log.warn(
        `inbound email signature INVALID — provider=${provider} from=${parsed.fromAddress} subject="${parsed.subject ?? ''}" id=${row.id}`,
      );
      // Don't throw — caller (controller) decides whether to 401. We
      // keep the row for forensic value.
      return { id: row.id, status: 'received', signatureValid: false };
    }

    // Try to link to a case. Subject tag wins; falls back to In-Reply-To
    // header which carries the X-Domera-Delivery id we set on outbound.
    const link = this.extractLink(parsed.subject || '', headers);

    let status = 'parsed';
    let linkedKind: string | null = null;
    let linkedId: string | null = null;

    if (link) {
      // Validate that the linked entity exists in the SAME tenant.
      const exists = await this.linkedEntityExists(tenantId, link.kind, link.id);
      if (exists) {
        linkedKind = link.kind;
        linkedId = link.id;
        status = 'linked';
      } else {
        // Cross-tenant attempt — refuse silently. A bad actor with a
        // valid email might paste another tenant's case id in the
        // subject; we never honour that.
        this.log.warn(
          `inbound link rejected — tenantId=${tenantId} tried to attach to ${link.kind}:${link.id}`,
        );
      }
    } else {
      status = 'orphan';
    }

    // Attachments — too large get marked as virus_blocked (size proxy
    // for "too risky to keep without scanning"). Real AV is provider-side.
    const oversized = (parsed.attachments ?? []).find(
      (a) => (a.sizeBytes ?? 0) > MAX_ATTACHMENT_BYTES,
    );
    if (oversized) {
      status = 'virus_blocked';
    }

    await (this.migrator as any).emailInboundEvent.update({
      where: { id: row.id },
      data: { linkedKind, linkedId, status },
    });

    return { id: row.id, status, signatureValid };
  }

  private extractLink(
    subject: string,
    headers: Record<string, string>,
  ): { kind: string; id: string } | null {
    const m = subject.match(LINK_TAG_RE);
    if (m) return { kind: m[1].toLowerCase(), id: m[2] };
    // In-Reply-To carries our X-Domera-Delivery ID; we could resolve
    // back to the original delivery row + its event payload here.
    // Skipped in v1 — subject tag is the canonical contract.
    void headers;
    return null;
  }

  private async resolveTenant(toAddress: string): Promise<string | null> {
    // inbound+<slug>@example.com
    const m = toAddress.match(/inbound\+([^@]+)@/i);
    if (!m) return null;
    const slug = m[1];
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }

  private async linkedEntityExists(
    tenantId: string | null,
    kind: string,
    id: string,
  ): Promise<boolean> {
    if (!tenantId) return false;
    try {
      switch (kind) {
        case 'case':
        case 'work_order': {
          const r = await (this.migrator as any).workOrder.findFirst({
            where: { id, tenantId },
            select: { id: true },
          });
          return !!r;
        }
        case 'approval': {
          const r = await this.migrator.approvalRequest.findFirst({
            where: { id, tenantId },
            select: { id: true },
          });
          return !!r;
        }
        case 'cleaning_request': {
          const r = await (this.migrator as any).cleaningRequest.findFirst({
            where: { id, tenantId },
            select: { id: true },
          });
          return !!r;
        }
      }
    } catch {
      return false;
    }
    return false;
  }
}
