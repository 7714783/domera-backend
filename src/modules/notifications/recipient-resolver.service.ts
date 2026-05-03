// INIT-014 — Recipient resolver.
//
// Given a NotificationRule + an OutboxEvent payload, returns the list of
// concrete recipients (TeamMember rows + their delivery addresses) the
// dispatcher should target.
//
// Three strategies:
//   · 'assignee'  — payload carries `assigneeTeamMemberId` or
//                   `assignedTeamMemberId`. Resolves to that single member.
//   · 'role'      — every active TeamMember holding the given role,
//                   intersected with `buildingScope` if set on the rule.
//   · 'manual'    — payload carries `recipientTeamMemberIds: string[]` or
//                   `recipientEmails: string[]`. Pass-through.
//
// All resolutions consult `notification_preferences` (mute opt-out per
// channel) and `email_suppressions` (hard bounces) before returning;
// suppressed addresses are filtered out silently (logged for ops).

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedRecipient {
  teamMemberId: string;
  recipientType: 'team_member';
  email: string | null;
  displayName: string;
  // Raw user id if the team member is linked to a User account — used
  // for in-app inbox delivery.
  userId: string | null;
}

export interface ResolveArgs {
  tenantId: string;
  rule: {
    recipientStrategy: string;
    roleKey: string | null;
    buildingScope: string[];
    templateKey: string | null;
    channels: string[];
  };
  payload: Record<string, unknown>;
  // Channel currently being resolved — preferences/suppressions are
  // channel-specific (an email mute should not silence in-app).
  channel: string;
}

@Injectable()
export class RecipientResolverService {
  private readonly log = new Logger('RecipientResolver');

  constructor(private readonly prisma: PrismaService) {}

  async resolve(args: ResolveArgs): Promise<ResolvedRecipient[]> {
    const candidates = await this.candidates(args);
    if (candidates.length === 0) return [];
    return this.applyOptOuts(args.tenantId, candidates, args.channel, args.rule.templateKey);
  }

  private async candidates(args: ResolveArgs): Promise<ResolvedRecipient[]> {
    const { rule, payload, tenantId } = args;
    if (rule.recipientStrategy === 'assignee') {
      const id =
        (payload['assignedTeamMemberId'] as string | undefined) ??
        (payload['assigneeTeamMemberId'] as string | undefined);
      if (!id) return [];
      return this.byTeamMemberIds(tenantId, [id]);
    }
    if (rule.recipientStrategy === 'role') {
      if (!rule.roleKey) return [];
      const grants = await (this.prisma as any).teamMemberRoleAssignment.findMany({
        where: {
          tenantId,
          roleKey: rule.roleKey,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          ...(rule.buildingScope.length > 0
            ? {
                OR: [
                  { buildingIds: { isEmpty: true } },
                  { buildingIds: { hasSome: rule.buildingScope } },
                ],
              }
            : {}),
          teamMember: { isActive: true },
        },
        select: { teamMemberId: true },
        distinct: ['teamMemberId'],
      });
      return this.byTeamMemberIds(
        tenantId,
        grants.map((g: any) => g.teamMemberId),
      );
    }
    if (rule.recipientStrategy === 'manual') {
      const ids = (payload['recipientTeamMemberIds'] as string[] | undefined) ?? [];
      const emails = (payload['recipientEmails'] as string[] | undefined) ?? [];
      const list: ResolvedRecipient[] = [];
      if (ids.length) {
        const members = await this.byTeamMemberIds(tenantId, ids);
        list.push(...members);
      }
      if (emails.length && args.channel === 'email') {
        // Manual email-only recipients — no team_member id, just an
        // address. We tag them as team_member with a synthetic id
        // upstream when needed; here we just include the raw email.
        for (const e of emails) {
          list.push({
            teamMemberId: '',
            recipientType: 'team_member',
            email: e,
            displayName: e,
            userId: null,
          });
        }
      }
      return list;
    }
    this.log.warn(`Unknown recipientStrategy: ${rule.recipientStrategy}`);
    return [];
  }

  private async byTeamMemberIds(tenantId: string, ids: string[]): Promise<ResolvedRecipient[]> {
    if (!ids.length) return [];
    const rows = await (this.prisma as any).teamMember.findMany({
      where: { tenantId, id: { in: ids }, isActive: true },
      select: { id: true, displayName: true, email: true, userId: true },
    });
    return rows.map((r: any) => ({
      teamMemberId: r.id,
      recipientType: 'team_member' as const,
      email: r.email,
      displayName: r.displayName,
      userId: r.userId,
    }));
  }

  // Strip recipients that have a mute preference for this channel/template
  // OR (for email) sit on the suppression list.
  private async applyOptOuts(
    tenantId: string,
    list: ResolvedRecipient[],
    channel: string,
    templateKey: string | null,
  ): Promise<ResolvedRecipient[]> {
    if (list.length === 0) return list;
    const memberIds = list.map((r) => r.teamMemberId).filter(Boolean);
    const muted = memberIds.length
      ? await (this.prisma as any).notificationPreference.findMany({
          where: {
            tenantId,
            teamMemberId: { in: memberIds },
            channel,
            muted: true,
            ...(templateKey
              ? {
                  OR: [
                    { scope: 'template', scopeKey: templateKey },
                    { scope: 'category' }, // we don't carry category here; handled coarse
                  ],
                }
              : {}),
          },
          select: { teamMemberId: true },
        })
      : [];
    const mutedIds = new Set(muted.map((m: any) => m.teamMemberId));

    let suppressedEmails = new Set<string>();
    if (channel === 'email') {
      const emails = list.map((r) => r.email?.toLowerCase()).filter(Boolean) as string[];
      if (emails.length) {
        const sup = await (this.prisma as any).emailSuppression.findMany({
          where: {
            OR: [{ tenantId }, { tenantId: null }],
            emailAddress: { in: emails },
          },
          select: { emailAddress: true },
        });
        suppressedEmails = new Set(sup.map((s: any) => s.emailAddress.toLowerCase()));
      }
    }

    return list.filter((r) => {
      if (r.teamMemberId && mutedIds.has(r.teamMemberId)) return false;
      if (channel === 'email' && r.email && suppressedEmails.has(r.email.toLowerCase()))
        return false;
      if (channel === 'email' && !r.email) return false; // can't email someone with no address
      return true;
    });
  }
}
