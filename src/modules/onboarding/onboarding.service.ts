import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60) || 'entity';
  }

  async createWorkspace(actorUserId: string, body: { name: string; slug?: string; timezone?: string; locale?: string }) {
    if (!body.name) throw new BadRequestException('name required');
    const user = await this.prisma.user.findUnique({ where: { id: actorUserId } });
    if (!user) throw new NotFoundException('user not found');

    const slug = this.slugify(body.slug || body.name);
    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) throw new ConflictException('slug already taken');

    const tenant = await this.prisma.tenant.create({
      data: {
        slug,
        name: body.name,
        timezone: body.timezone || 'UTC',
        defaultUiLocale: body.locale || 'en',
        defaultContentLocale: body.locale || 'en',
        status: 'active',
        isDemo: false,
        createdBy: `user:${actorUserId}`,
      },
    });

    await this.prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, roleKey: 'workspace_owner', status: 'active' },
    });

    await this.prisma.auditEntry.create({
      data: {
        tenantId: tenant.id, actor: actorUserId, role: 'workspace_owner',
        action: 'Workspace created', entity: tenant.slug, entityType: 'workspace',
        building: '', ip: '127.0.0.1', eventType: 'workspace.created',
        resourceType: 'workspace', resourceId: tenant.id,
      },
    });

    return tenant;
  }

  async createOrganization(
    actorUserId: string,
    body: { tenantId: string; name: string; slug?: string; type: 'owner' | 'management_company' | 'vendor' | 'consultant' },
  ) {
    if (!body.name || !body.tenantId || !body.type) throw new BadRequestException('name, tenantId, type required');
    const membership = await this.prisma.membership.findFirst({
      where: { tenantId: body.tenantId, userId: actorUserId, roleKey: { in: ['workspace_owner', 'workspace_admin', 'org_admin'] } },
    });
    if (!membership) throw new ForbiddenException('not authorized in this workspace');

    const slug = this.slugify(body.slug || body.name);
    const existing = await this.prisma.organization.findFirst({ where: { tenantId: body.tenantId, slug } });
    if (existing) throw new ConflictException('organization slug already taken in this workspace');

    const org = await this.prisma.organization.create({
      data: {
        tenantId: body.tenantId,
        name: body.name,
        slug,
        type: body.type,
        status: 'active',
        isDemo: false,
        createdBy: `user:${actorUserId}`,
      },
    });

    await this.prisma.organizationMembership.create({
      data: { organizationId: org.id, userId: actorUserId, roleKey: 'org_admin' },
    });

    await this.prisma.auditEntry.create({
      data: {
        tenantId: body.tenantId, actor: actorUserId, role: 'org_admin',
        action: 'Organization created', entity: org.slug, entityType: 'organization',
        building: '', ip: '127.0.0.1', eventType: 'organization.created',
        resourceType: 'organization', resourceId: org.id,
      },
    });

    return org;
  }

  async createBuilding(
    actorUserId: string,
    body: {
      tenantId: string;
      organizationId?: string;
      name: string;
      slug?: string;
      addressLine1: string;
      street?: string;
      buildingNumber?: string;
      city: string;
      countryCode: string;
      lat?: number;
      lng?: number;
      timezone: string;
      buildingType?: 'residential' | 'office' | 'mixed' | 'commercial';
      type?: string;
      yearBuilt?: number;
      floorsCount?: number;
      unitsCount?: number;
      entrancesCount?: number;
      liftsCount?: number;
      annualKwh?: number;
      defaultLanguage?: string;
      supportedLanguages?: string[];
      entrances?: Array<{ name: string; number?: string }>;
      floors?: Array<{ number: number; entranceName?: string; label?: string }>;
      units?: Array<{ number: string; unitType: string; floorNumber?: number; area?: number; rooms?: number }>;
      settings?: { currency?: string; billingCycle?: string; taxRules?: unknown; locale?: string };
    },
  ) {
    if (!body.name || !body.tenantId || !body.addressLine1 || !body.city || !body.countryCode || !body.timezone) {
      throw new BadRequestException('name, tenantId, addressLine1, city, countryCode, timezone required');
    }
    const membership = await this.prisma.membership.findFirst({
      where: { tenantId: body.tenantId, userId: actorUserId, roleKey: { in: ['workspace_owner', 'workspace_admin', 'org_admin'] } },
    });
    if (!membership) throw new ForbiddenException('not authorized in this workspace');

    const slug = this.slugify(body.slug || body.name);
    const conflict = await this.prisma.building.findUnique({
      where: { tenantId_slug: { tenantId: body.tenantId, slug } },
    });
    if (conflict) throw new ConflictException('building slug already taken in this workspace');

    const entrancesInput = (body.entrances && body.entrances.length)
      ? body.entrances
      : Array.from({ length: body.entrancesCount || 0 }, (_, i) => ({ name: `Entrance ${i + 1}`, number: String(i + 1) }));

    const floorsInput: Array<{ number: number; entranceName?: string; label?: string }> = (body.floors && body.floors.length)
      ? body.floors
      : Array.from({ length: body.floorsCount || 0 }, (_, i) => ({ number: i + 1 }));

    const building = await this.prisma.$transaction(async (tx) => {
      const created = await tx.building.create({
        data: {
          tenantId: body.tenantId,
          organizationId: body.organizationId || null,
          slug,
          name: body.name,
          addressLine1: body.addressLine1,
          street: body.street || null,
          buildingNumber: body.buildingNumber || null,
          city: body.city,
          countryCode: body.countryCode,
          lat: body.lat ?? null,
          lng: body.lng ?? null,
          timezone: body.timezone,
          type: body.type || (body.buildingType === 'office' ? 'Office' : body.buildingType === 'residential' ? 'Residential' : 'Commercial'),
          buildingType: body.buildingType || null,
          yearBuilt: body.yearBuilt ?? null,
          floorsCount: body.floorsCount ?? floorsInput.length ?? null,
          unitsCount: body.unitsCount ?? (body.units?.length ?? null),
          entrancesCount: body.entrancesCount ?? entrancesInput.length ?? null,
          liftsCount: body.liftsCount ?? null,
          annualKwh: body.annualKwh ?? null,
          defaultLanguage: body.defaultLanguage || null,
          supportedLanguages: body.supportedLanguages || [],
          status: 'active',
          isDemo: false,
          createdBy: `user:${actorUserId}`,
        },
      });

      const entranceByName = new Map<string, string>();
      for (const e of entrancesInput) {
        const row = await tx.entrance.create({
          data: { tenantId: body.tenantId, buildingId: created.id, name: e.name, number: e.number || null },
        });
        entranceByName.set(e.name, row.id);
      }

      const floorNumberToId = new Map<number, string>();
      for (const f of floorsInput) {
        const entranceId = f.entranceName ? entranceByName.get(f.entranceName) || null : null;
        const row = await tx.floor.create({
          data: { tenantId: body.tenantId, buildingId: created.id, entranceId, number: f.number, label: f.label || null },
        });
        floorNumberToId.set(f.number, row.id);
      }

      for (const u of body.units || []) {
        await tx.unit.create({
          data: {
            tenantId: body.tenantId,
            buildingId: created.id,
            floorId: u.floorNumber ? floorNumberToId.get(u.floorNumber) || null : null,
            number: u.number,
            unitType: u.unitType,
            area: u.area ?? null,
            rooms: u.rooms ?? null,
          },
        });
      }

      const liftsCount = body.liftsCount ?? 0;
      if (liftsCount > 0) {
        const root = await tx.asset.create({
          data: {
            tenantId: body.tenantId, buildingId: created.id, name: 'Vertical Transport',
            class: 'system', systemType: 'vertical_transport', createdBy: `user:${actorUserId}`,
          },
        });
        for (let i = 0; i < liftsCount; i++) {
          await tx.asset.create({
            data: {
              tenantId: body.tenantId, buildingId: created.id, parentAssetId: root.id,
              name: `Lift ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`,
              class: 'lift', systemType: 'vertical_transport',
              createdBy: `user:${actorUserId}`,
            },
          });
        }
      }

      await tx.buildingSettings.create({
        data: {
          buildingId: created.id,
          currency: body.settings?.currency || 'USD',
          timezone: body.timezone,
          billingCycle: body.settings?.billingCycle || 'monthly',
          taxRules: (body.settings?.taxRules as any) ?? null,
          locale: body.settings?.locale || body.defaultLanguage || 'en',
        },
      });

      if (body.organizationId) {
        await tx.buildingMandate.create({
          data: {
            tenantId: body.tenantId, buildingId: created.id, organizationId: body.organizationId,
            mandateType: 'owner', effectiveFrom: new Date(),
          },
        });
      }

      await tx.buildingRoleAssignment.create({
        data: {
          tenantId: body.tenantId, buildingId: created.id, userId: actorUserId,
          roleKey: 'building_manager', delegatedBy: actorUserId,
        },
      });

      await tx.auditEntry.create({
        data: {
          tenantId: body.tenantId, buildingId: created.id, actor: actorUserId, role: 'workspace_owner',
          action: 'Building created', entity: created.slug, entityType: 'building',
          building: created.name, ip: '127.0.0.1', eventType: 'building.created',
          resourceType: 'building', resourceId: created.id,
          metadata: {
            entrances: entrancesInput.length, floors: floorsInput.length,
            units: body.units?.length || 0, lifts: liftsCount,
          },
        },
      });

      return created;
    });

    const stats = {
      entrances: await this.prisma.entrance.count({ where: { buildingId: building.id } }),
      floors: await this.prisma.floor.count({ where: { buildingId: building.id } }),
      units: await this.prisma.unit.count({ where: { buildingId: building.id } }),
      lifts: await this.prisma.asset.count({ where: { buildingId: building.id, class: 'lift' } }),
    };
    return { ...building, stats };
  }

  async bootstrapFirstBuilding(
    actorUserId: string,
    body: {
      buildingName: string;
      addressLine1: string;
      city: string;
      countryCode: string;
      timezone: string;
      buildingType?: 'residential' | 'office' | 'mixed' | 'commercial';
      workspaceName?: string;
    },
  ) {
    if (!body.buildingName || !body.addressLine1 || !body.city || !body.countryCode || !body.timezone) {
      throw new BadRequestException('buildingName, addressLine1, city, countryCode, timezone required');
    }

    const user = await this.prisma.user.findUnique({ where: { id: actorUserId } });
    if (!user) throw new NotFoundException('user not found');

    let tenantId: string;
    let organizationId: string;

    const existingMembership = await this.prisma.membership.findFirst({
      where: { userId: actorUserId, roleKey: 'workspace_owner' },
    });

    if (existingMembership) {
      tenantId = existingMembership.tenantId;
      const existingOrg = await this.prisma.organization.findFirst({
        where: { tenantId, type: 'owner' },
      });
      if (existingOrg) {
        organizationId = existingOrg.id;
      } else {
        const org = await this.prisma.organization.create({
          data: {
            tenantId,
            name: body.workspaceName || `${user.displayName || user.username} Portfolio`,
            slug: this.slugify(`${user.username}-portfolio`),
            type: 'owner',
            status: 'active',
            createdBy: `user:${actorUserId}`,
          },
        });
        organizationId = org.id;
      }
    } else {
      const wsName = body.workspaceName || `${user.displayName || user.username} Portfolio`;
      const tenant = await this.prisma.tenant.create({
        data: {
          slug: await this.uniqueSlug('tenant', this.slugify(wsName)),
          name: wsName,
          timezone: body.timezone,
          defaultUiLocale: 'en',
          defaultContentLocale: 'en',
          status: 'active',
          createdBy: `user:${actorUserId}`,
        },
      });
      tenantId = tenant.id;

      await this.prisma.membership.create({
        data: { tenantId, userId: actorUserId, roleKey: 'workspace_owner', status: 'active' },
      });

      const org = await this.prisma.organization.create({
        data: {
          tenantId,
          name: wsName,
          slug: this.slugify(wsName),
          type: 'owner',
          status: 'active',
          createdBy: `user:${actorUserId}`,
        },
      });
      organizationId = org.id;

      await this.prisma.organizationMembership.create({
        data: { organizationId: org.id, userId: actorUserId, roleKey: 'org_admin' },
      });

      await this.prisma.auditEntry.create({
        data: {
          tenantId, actor: actorUserId, role: 'workspace_owner',
          action: 'Workspace auto-provisioned', entity: tenant.slug, entityType: 'workspace',
          building: '', ip: '127.0.0.1', eventType: 'workspace.created',
          resourceType: 'workspace', resourceId: tenant.id,
        },
      });
    }

    const building = await this.createBuilding(actorUserId, {
      tenantId,
      organizationId,
      name: body.buildingName,
      addressLine1: body.addressLine1,
      city: body.city,
      countryCode: body.countryCode,
      timezone: body.timezone,
      buildingType: body.buildingType,
    });

    return { tenantId, organizationId, building };
  }

  private async uniqueSlug(kind: 'tenant', base: string): Promise<string> {
    let candidate = base;
    let n = 1;
    while (true) {
      const clash = await this.prisma.tenant.findUnique({ where: { slug: candidate } });
      if (!clash) return candidate;
      n += 1;
      candidate = `${base}-${n}`;
    }
  }

  async updateBuilding(
    actorUserId: string,
    tenantId: string,
    slug: string,
    patch: {
      name?: string;
      buildingType?: string;
      yearBuilt?: number | null;
      floorsCount?: number | null;
      unitsCount?: number | null;
      entrancesCount?: number | null;
      liftsCount?: number | null;
      street?: string | null;
      buildingNumber?: string | null;
      lat?: number | null;
      lng?: number | null;
      annualKwh?: number | null;
      defaultLanguage?: string | null;
      supportedLanguages?: string[];
      settings?: { currency?: string; billingCycle?: string; locale?: string; taxRules?: unknown };
      entrances?: Array<{ name: string; number?: string }>;
      floors?: Array<{ number: number; label?: string; entranceName?: string }>;
      liftsPlan?: number;
    },
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: { in: ['workspace_owner', 'workspace_admin', 'org_admin'] } },
    });
    const buildingRole = await this.prisma.buildingRoleAssignment.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: { in: ['building_manager', 'chief_engineer'] } },
    });
    if (!membership && !buildingRole) throw new ForbiddenException('not authorized');

    const building = await this.prisma.building.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
    });
    if (!building) throw new NotFoundException('building not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const b = await tx.building.update({
        where: { id: building.id },
        data: {
          name: patch.name ?? building.name,
          buildingType: patch.buildingType ?? building.buildingType,
          yearBuilt: patch.yearBuilt !== undefined ? patch.yearBuilt : building.yearBuilt,
          floorsCount: patch.floorsCount !== undefined ? patch.floorsCount : building.floorsCount,
          unitsCount: patch.unitsCount !== undefined ? patch.unitsCount : building.unitsCount,
          entrancesCount: patch.entrancesCount !== undefined ? patch.entrancesCount : building.entrancesCount,
          liftsCount: patch.liftsCount !== undefined ? patch.liftsCount : building.liftsCount,
          street: patch.street !== undefined ? patch.street : building.street,
          buildingNumber: patch.buildingNumber !== undefined ? patch.buildingNumber : building.buildingNumber,
          lat: patch.lat !== undefined ? patch.lat : building.lat,
          lng: patch.lng !== undefined ? patch.lng : building.lng,
          annualKwh: patch.annualKwh !== undefined ? patch.annualKwh : building.annualKwh,
          defaultLanguage: patch.defaultLanguage !== undefined ? patch.defaultLanguage : building.defaultLanguage,
          supportedLanguages: patch.supportedLanguages ?? building.supportedLanguages,
        },
      });

      if (patch.settings) {
        await tx.buildingSettings.upsert({
          where: { buildingId: building.id },
          create: {
            buildingId: building.id,
            currency: patch.settings.currency || 'USD',
            billingCycle: patch.settings.billingCycle || 'monthly',
            locale: patch.settings.locale || 'en',
            timezone: building.timezone,
            taxRules: (patch.settings.taxRules as any) ?? null,
          },
          update: {
            currency: patch.settings.currency,
            billingCycle: patch.settings.billingCycle,
            locale: patch.settings.locale,
            taxRules: (patch.settings.taxRules as any) ?? undefined,
          },
        });
      }

      if (patch.entrances) {
        const existing = await tx.entrance.findMany({ where: { buildingId: building.id } });
        const keepNames = new Set(patch.entrances.map((e) => e.name));
        for (const e of existing) {
          if (!keepNames.has(e.name)) await tx.entrance.delete({ where: { id: e.id } });
        }
        for (const e of patch.entrances) {
          const match = existing.find((x) => x.name === e.name);
          if (match) {
            await tx.entrance.update({ where: { id: match.id }, data: { number: e.number || null } });
          } else {
            await tx.entrance.create({
              data: { tenantId, buildingId: building.id, name: e.name, number: e.number || null },
            });
          }
        }
      }

      if (patch.floors) {
        const entrances = await tx.entrance.findMany({ where: { buildingId: building.id } });
        const byName = new Map(entrances.map((e) => [e.name, e.id]));
        await tx.floor.deleteMany({ where: { buildingId: building.id } });
        for (const f of patch.floors) {
          const entranceId = f.entranceName ? byName.get(f.entranceName) || null : null;
          await tx.floor.create({
            data: { tenantId, buildingId: building.id, entranceId, number: f.number, label: f.label || null },
          });
        }
      }

      if (patch.liftsPlan !== undefined) {
        const existing = await tx.asset.findMany({
          where: { buildingId: building.id, class: 'lift' },
          orderBy: { name: 'asc' },
        });
        const target = Math.max(0, patch.liftsPlan);
        if (target < existing.length) {
          for (const lift of existing.slice(target)) {
            await tx.asset.delete({ where: { id: lift.id } });
          }
        } else if (target > existing.length) {
          let root = await tx.asset.findFirst({
            where: { buildingId: building.id, class: 'system', systemType: 'vertical_transport' },
          });
          if (!root) {
            root = await tx.asset.create({
              data: {
                tenantId, buildingId: building.id, name: 'Vertical Transport',
                class: 'system', systemType: 'vertical_transport', createdBy: `user:${actorUserId}`,
              },
            });
          }
          for (let i = existing.length; i < target; i++) {
            await tx.asset.create({
              data: {
                tenantId, buildingId: building.id, parentAssetId: root.id,
                name: `Lift ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`,
                class: 'lift', systemType: 'vertical_transport',
                createdBy: `user:${actorUserId}`,
              },
            });
          }
        }
      }

      await tx.auditEntry.create({
        data: {
          tenantId, buildingId: building.id, actor: actorUserId, role: 'building_manager',
          action: 'Building updated', entity: b.slug, entityType: 'building',
          building: b.name, ip: '127.0.0.1', eventType: 'building.updated',
          resourceType: 'building', resourceId: b.id,
        },
      });

      return b;
    });

    return updated;
  }

  async buildingFull(tenantId: string, slug: string) {
    const building = await this.prisma.building.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
      include: {
        entrances: { orderBy: { name: 'asc' } },
        floors: { orderBy: { number: 'asc' } },
        units: { orderBy: { number: 'asc' } },
        settings: true,
        organization: true,
      },
    });
    if (!building) throw new NotFoundException('building not found');
    const lifts = await this.prisma.asset.findMany({
      where: { buildingId: building.id, class: 'lift' },
      orderBy: { name: 'asc' },
    });
    return { ...building, lifts };
  }

  async myWorkspaces(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'active' },
      include: { tenant: true },
      orderBy: { createdAt: 'desc' },
    });
    return memberships.map((m) => ({
      tenantId: m.tenantId,
      slug: m.tenant.slug,
      name: m.tenant.name,
      roleKey: m.roleKey,
      timezone: m.tenant.timezone,
    }));
  }
}
