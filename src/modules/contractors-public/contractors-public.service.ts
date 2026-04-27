// INIT-013 — global PublicContractor registry.
//
// PublicContractors are NOT tenant-scoped. They live in a single global
// table and are referenced by N WorkspaceContractor rows across N
// workspaces. The data here is intentionally limited to what a contractor
// firm is happy to expose publicly: name, public phone/email, country,
// licenses, specialisations.
//
// Writes:
//   · Any authenticated user with `role.manage` permission may create a
//     new PublicContractor when adding it as a WorkspaceContractor for
//     the first time. The createdByTenantId is recorded for audit.
//   · A super-admin can `verify` an entry (verificationState transitions
//     unverified → platform_verified) — that mark is shown as a trust
//     badge cross-workspace.
//   · Self-attested writes are allowed for any authenticated user; admins
//     gate on the role manage permission elsewhere.

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { MigratorPrismaService } from '../../prisma/prisma.migrator';

export interface PublicContractorCreate {
  displayName: string;
  legalName?: string;
  publicPhone?: string;
  publicEmail?: string;
  website?: string;
  country?: string;
  city?: string;
  specialisations?: string[];
  licenses?: string[];
}

@Injectable()
export class ContractorsPublicService {
  // BYPASSRLS — public_contractors has NO tenantId column and no RLS.
  // We use the migrator client to dodge any RLS policy that might be
  // attached to a related table during a transaction.
  constructor(private readonly prisma: MigratorPrismaService) {}

  async list(opts: { search?: string; limit?: number } = {}) {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const where: any = {};
    if (opts.search) {
      const q = opts.search.trim();
      where.OR = [
        { displayName: { contains: q, mode: 'insensitive' } },
        { legalName: { contains: q, mode: 'insensitive' } },
        { publicPhone: { contains: q } },
        { publicEmail: { contains: q, mode: 'insensitive' } },
      ];
    }
    const items = await (this.prisma as any).publicContractor.findMany({
      where,
      orderBy: [{ displayName: 'asc' }],
      take,
    });
    return { total: items.length, items };
  }

  async getOne(id: string) {
    const r = await (this.prisma as any).publicContractor.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('public contractor not found');
    return r;
  }

  async create(actorTenantId: string, body: PublicContractorCreate) {
    if (!body.displayName?.trim()) {
      throw new BadRequestException('displayName required');
    }
    // Soft-dedup on phone OR email — if a row exists, return it instead
    // of creating a duplicate. The caller can still link a separate
    // WorkspaceContractor against it.
    if (body.publicPhone || body.publicEmail) {
      const existing = await (this.prisma as any).publicContractor.findFirst({
        where: {
          OR: [
            body.publicPhone ? { publicPhone: body.publicPhone } : undefined,
            body.publicEmail ? { publicEmail: body.publicEmail } : undefined,
          ].filter(Boolean) as any[],
        },
      });
      if (existing) return existing;
    }
    return (this.prisma as any).publicContractor.create({
      data: {
        displayName: body.displayName.trim(),
        legalName: body.legalName ?? null,
        publicPhone: body.publicPhone ?? null,
        publicEmail: body.publicEmail ?? null,
        website: body.website ?? null,
        country: body.country ?? null,
        city: body.city ?? null,
        specialisations: body.specialisations ?? [],
        licenses: body.licenses ?? [],
        createdByTenantId: actorTenantId,
      },
    });
  }

  async update(id: string, body: Partial<PublicContractorCreate>) {
    const existing = await (this.prisma as any).publicContractor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('public contractor not found');
    return (this.prisma as any).publicContractor.update({
      where: { id },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.legalName !== undefined ? { legalName: body.legalName } : {}),
        ...(body.publicPhone !== undefined ? { publicPhone: body.publicPhone } : {}),
        ...(body.publicEmail !== undefined ? { publicEmail: body.publicEmail } : {}),
        ...(body.website !== undefined ? { website: body.website } : {}),
        ...(body.country !== undefined ? { country: body.country } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.specialisations !== undefined ? { specialisations: body.specialisations } : {}),
        ...(body.licenses !== undefined ? { licenses: body.licenses } : {}),
      },
    });
  }
}
