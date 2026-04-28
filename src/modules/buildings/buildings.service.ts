import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PpmService } from '../ppm/ppm.service';
import { requireManager } from '../../common/building.helpers';

export interface BuildingListItem {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  buildingType: string | null;
  address: string;
  organization: string;
  status: string;
  floorsCount: number | null;
  unitsCount: number | null;
  compliance: number;
}

@Injectable()
export class BuildingsService {
  private readonly logger = new Logger(BuildingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ppm: PpmService,
  ) {}

  private slugify(input: string): string {
    return (
      input
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60) || 'building'
    );
  }

  private requireManager = (tenantId: string, actorUserId: string) =>
    requireManager(this.prisma, tenantId, actorUserId);

  async list(tenantId: string): Promise<BuildingListItem[]> {
    const buildings = await this.prisma.building.findMany({
      where: { tenantId },
      include: { organization: true },
      orderBy: { name: 'asc' },
    });
    return buildings.map((b) => ({
      id: b.id,
      tenantId: b.tenantId,
      slug: b.slug,
      name: b.name,
      buildingType: b.buildingType,
      address: `${b.addressLine1}, ${b.city}`,
      organization: b.organization?.name || 'Unassigned',
      status: b.status,
      floorsCount: b.floorsCount,
      unitsCount: b.unitsCount,
      compliance: b.compliance,
    }));
  }

  async getOne(tenantId: string, idOrSlug: string) {
    const where =
      idOrSlug.includes('-') && idOrSlug.length === 36
        ? { id: idOrSlug }
        : { tenantId_slug: { tenantId, slug: idOrSlug } };
    const building = await this.prisma.building.findUnique({
      where: where as any,
      include: {
        organization: true,
        entrances: { orderBy: { name: 'asc' } },
        floors: { orderBy: { number: 'asc' } },
        units: { orderBy: { number: 'asc' } },
        settings: true,
      },
    });
    if (!building || building.tenantId !== tenantId)
      throw new NotFoundException('building not found');
    const lifts = await this.prisma.asset.findMany({
      where: { buildingId: building.id, class: 'lift' },
      orderBy: { name: 'asc' },
    });
    return { ...building, lifts };
  }

  async create(
    tenantId: string,
    actorUserId: string,
    body: {
      name: string;
      slug?: string;
      addressLine1: string;
      city: string;
      countryCode: string;
      timezone: string;
      organizationId?: string;
      buildingType?: string;
      buildingCode?: string;
      primaryUse?: string;
      secondaryUses?: string[];
      complexityFlags?: string[];
      yearBuilt?: number;
      floorsAboveGround?: number;
      floorsBelowGround?: number;
      floorsCount?: number;
      unitsCount?: number;
      entrancesCount?: number;
      liftsCount?: number;
      hasParking?: boolean;
      hasRestaurantsGroundFloor?: boolean;
      hasRooftopMechanical?: boolean;
      notes?: string;
      status?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.name || !body.addressLine1 || !body.city || !body.countryCode || !body.timezone) {
      throw new BadRequestException('name, addressLine1, city, countryCode, timezone required');
    }
    const slug = this.slugify(body.slug || body.name);
    const conflict = await this.prisma.building.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
    });
    if (conflict) throw new BadRequestException('building slug already taken');

    const building = await this.prisma.building.create({
      data: {
        tenantId,
        organizationId: body.organizationId || null,
        slug,
        name: body.name,
        addressLine1: body.addressLine1,
        city: body.city,
        countryCode: body.countryCode,
        timezone: body.timezone,
        type:
          body.buildingType === 'office_tower' || body.buildingType === 'office'
            ? 'Office'
            : body.buildingType === 'residential'
              ? 'Residential'
              : 'Commercial',
        buildingType: body.buildingType || null,
        buildingCode: body.buildingCode || null,
        primaryUse: body.primaryUse || null,
        secondaryUses: body.secondaryUses || [],
        complexityFlags: body.complexityFlags || [],
        yearBuilt: body.yearBuilt ?? null,
        floorsAboveGround: body.floorsAboveGround ?? null,
        floorsBelowGround: body.floorsBelowGround ?? null,
        floorsCount: body.floorsCount ?? null,
        unitsCount: body.unitsCount ?? null,
        entrancesCount: body.entrancesCount ?? null,
        liftsCount: body.liftsCount ?? null,
        hasParking: body.hasParking ?? null,
        hasRestaurantsGroundFloor: body.hasRestaurantsGroundFloor ?? null,
        hasRooftopMechanical: body.hasRooftopMechanical ?? null,
        notes: body.notes || null,
        status: body.status || 'active',
        createdBy: `user:${actorUserId}`,
      },
    });

    await this.prisma.buildingSettings.create({
      data: {
        buildingId: building.id,
        currency: 'USD',
        timezone: body.timezone,
        billingCycle: 'monthly',
        locale: 'en',
      },
    });

    await this.prisma.buildingRoleAssignment.create({
      data: {
        tenantId,
        buildingId: building.id,
        userId: actorUserId,
        roleKey: 'building_manager',
        delegatedBy: actorUserId,
      },
    });

    if (body.organizationId) {
      await this.prisma.buildingMandate.create({
        data: {
          tenantId,
          buildingId: building.id,
          organizationId: body.organizationId,
          mandateType: 'owner',
          effectiveFrom: new Date(),
        },
      });
    }

    await this.audit.write({
      tenantId,
      buildingId: building.id,
      actor: actorUserId,
      role: 'workspace_owner',
      action: 'Building created',
      entity: building.slug,
      entityType: 'building',
      building: building.name,
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'building.created',
      resourceType: 'building',
      resourceId: building.id,
    });

    // Seed the PPM backlog so the new building enters the standard lifecycle
    // (every obligation → a pending PpmPlanItem visible on /ppm/setup).
    // PPM is the single writer of ppm_* tables — buildings delegates via PpmService.
    // Runs after the building row is committed; if this fails we log but do NOT
    // fail the whole creation (building is usable and the operator can rerun
    // the seed later from the Setup page).
    try {
      const res = await this.ppm.seedPendingPlanItemsForBuilding({
        tenantId,
        buildingId: building.id,
        actorUserId,
      });
      if (res.created > 0) {
        await this.audit.write({
          tenantId,
          buildingId: building.id,
          actor: actorUserId,
          role: 'workspace_owner',
          action: `PPM backlog seeded: ${res.created} plan items awaiting setup`,
          entity: building.slug,
          entityType: 'building',
          building: building.name,
          ip: '127.0.0.1',
          sensitive: false,
          eventType: 'ppm.backlog_seeded',
          resourceType: 'building',
          resourceId: building.id,
          metadata: { created: res.created, skipped: res.skipped, total: res.total },
        });
      }
    } catch (e) {
      this.logger.warn(
        `PPM seed failed for building ${building.id} (${building.slug}): ${(e as Error).message}`,
      );
    }

    return building;
  }

  async update(tenantId: string, actorUserId: string, slug: string, patch: Record<string, any>) {
    await this.requireManager(tenantId, actorUserId);
    const existing = await this.prisma.building.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
    });
    if (!existing) throw new NotFoundException('building not found');

    const allowed: Array<keyof typeof patch> = [
      'name',
      'buildingCode',
      'buildingType',
      'primaryUse',
      'secondaryUses',
      'complexityFlags',
      'yearBuilt',
      'floorsAboveGround',
      'floorsBelowGround',
      'floorsCount',
      'unitsCount',
      'entrancesCount',
      'liftsCount',
      'hasParking',
      'hasRestaurantsGroundFloor',
      'hasRooftopMechanical',
      'street',
      'buildingNumber',
      'lat',
      'lng',
      'annualKwh',
      'defaultLanguage',
      'supportedLanguages',
      'status',
      'organizationId',
      'notes',
    ];
    const data: Record<string, any> = {};
    for (const k of allowed) if (k in patch) data[k] = patch[k];

    const updated = await this.prisma.building.update({ where: { id: existing.id }, data });

    await this.audit.write({
      tenantId,
      buildingId: existing.id,
      actor: actorUserId,
      role: 'building_manager',
      action: 'Building updated',
      entity: updated.slug,
      entityType: 'building',
      building: updated.name,
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'building.updated',
      resourceType: 'building',
      resourceId: updated.id,
    });
    return updated;
  }

  // INIT-012 Phase 2 — building lifecycle state machine.
  //
  // Allowed transitions:
  //   draft    → active     (publish — onboarding wizard finished)
  //   draft    → archived   (cancel a never-finished onboarding)
  //   active   → archived   (decommission)
  //   archived → active     (re-activate)
  //
  // Forbidden:
  //   active   → draft   (cannot un-publish; create a new draft instead)
  //   archived → draft   (would lose audit + history)
  //
  // Mirrors apps/api/test/state-machine.test.mjs REGISTRY.building.
  private readonly LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
    draft: ['active', 'archived'],
    active: ['archived'],
    archived: ['active'],
  };

  async publishBuilding(tenantId: string, actorUserId: string, slug: string) {
    return this.transitionLifecycle(tenantId, actorUserId, slug, 'active');
  }

  async archiveBuilding(tenantId: string, actorUserId: string, slug: string) {
    return this.transitionLifecycle(tenantId, actorUserId, slug, 'archived');
  }

  async reactivateBuilding(tenantId: string, actorUserId: string, slug: string) {
    return this.transitionLifecycle(tenantId, actorUserId, slug, 'active');
  }

  private async transitionLifecycle(
    tenantId: string,
    actorUserId: string,
    slug: string,
    to: 'active' | 'archived',
  ) {
    await this.requireManager(tenantId, actorUserId);
    const existing = await this.prisma.building.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
    });
    if (!existing) throw new NotFoundException('building not found');

    const from = (existing as any).lifecycleStatus || 'active';
    const allowed = this.LIFECYCLE_TRANSITIONS[from] || [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `cannot transition building lifecycle ${from} → ${to}`,
      );
    }

    const data: Record<string, any> = { lifecycleStatus: to };
    if (to === 'active' && !(existing as any).publishedAt) {
      data.publishedAt = new Date();
    }
    if (to === 'archived') {
      data.archivedAt = new Date();
    }
    if (to === 'active' && from === 'archived') {
      data.archivedAt = null;
    }

    const updated = await this.prisma.building.update({
      where: { id: existing.id },
      data,
    });

    await this.audit.transition({
      tenantId,
      actor: actorUserId,
      actorRole: 'manager',
      entityType: 'building',
      entityId: existing.id,
      from,
      to,
      buildingId: existing.id,
      sensitive: true,
      metadata: {
        slug: existing.slug,
        name: existing.name,
        publishedAt: data.publishedAt,
        archivedAt: data.archivedAt,
      },
    });

    return updated;
  }

  // Permanent destruction of a building + every building-scoped record.
  // Tenant-shared resources (User, ContractorCompany, AssetType, PpmTemplate
  // catalogue, Role, Membership, Document templates) survive untouched.
  // Audit entries survive with `buildingId = NULL` because the FK is
  // `onDelete: SetNull` (audit_entries.buildingId).
  //
  // Two-factor confirmation:
  //   1. Caller must hold `workspace_owner` role (strictest gate the system
  //      has — operations like archive use `workspace_admin` but destruction
  //      is owner-only).
  //   2. Body MUST include `confirmText` exactly equal to the building's
  //      current `name` (case-sensitive after trim) — typing the name out
  //      letter-for-letter is the spontaneous-phrase-style guard the user
  //      asked for. Different from `slug`: slugs are short and predictable;
  //      names are the human-readable label.
  //
  // What gets deleted (cascades through Prisma `onDelete: Cascade` FKs on
  // each child model's `building` relation):
  //   - BuildingFloor / BuildingUnit / BuildingUnitGroup / BuildingLocation
  //   - BuildingSystem / BuildingVerticalTransport / ElevatorProfile
  //   - BuildingOccupantCompany / BuildingUnitOccupancy / BuildingContract
  //   - BuildingMandate / BuildingComplianceProfile / BuildingObligation
  //   - Asset (and its CustomAttribute / Document / Media / AssetSparePart rows)
  //   - PpmPlanItem / TaskInstance / PpmExecutionLog / PpmTemplate (per-bldg)
  //   - Incident / ServiceRequest / WorkOrder / Quote / PurchaseOrder /
  //     CompletionRecord / Budget / BudgetLine / Invoice
  //   - CleaningContractor / CleaningStaff / CleaningZone / CleaningQrPoint /
  //     CleaningRequest (+ comments / history / attachments)
  //   - FloorAssignment, UserAvailability rows for users only on this bldg
  //   - QrLocation, Round (+ waypoints + instances + answers)
  //   - Project / ProjectStage / ChangeOrder / AcceptancePack
  //   - TenantRepresentative, EngineeringRecommendation, TakeoverCase
  //   - Device / SensorPoint / AlarmSource / ConditionTrigger / ConditionEvent
  //   - LeaseAllocation, Contract, EmergencyOverride, CalendarBlackout
  //     (per-building rows; tenant-level blackouts where buildingId IS NULL stay)
  //   - Document / DocumentLink (per-building rows)
  //   - BuildingRoleAssignment (per-building grants — Users + Membership stay)
  //   - Notification / Account / Entrance / Floor / Unit
  //     (legacy parallel models also cascade; ResidentRequest dropped in
  //      INIT-010 Follow-up F)
  //
  // What survives:
  //   - User, Membership (tenant-level), Role, RolePermission, Certification,
  //     UserCertification (tied to user, not building), UserMfa, FederatedIdentity
  //   - Tenant (unchanged), Organization, OrganizationMembership
  //   - ContractorCompany (universal vendor registry — tenant-scoped only)
  //   - AssetType (taxonomy template — survives so future buildings reuse it)
  //   - DocumentType, DocumentTemplate (templates)
  //   - ObligationTemplate, ApplicabilityRule, ObligationBasis (catalogue)
  //   - ComplianceProfile (template; per-building binding deleted)
  //   - PersonalDataCategory, DpaTemplate, SubprocessorRegistry (privacy)
  //   - AuditEntry rows (buildingId set to NULL post-delete, rows stay)
  //   - OutboxEvent, InboundWebhookSource/Event, WebhookSubscription, IdentityProvider, ScimToken
  //   - SeedRun, OidcLoginState, Session
  //   - CalendarBlackout rows where buildingId IS NULL (tenant-wide windows)
  async deleteBuilding(
    tenantId: string,
    actorUserId: string,
    slug: string,
    body: { confirmText?: string },
  ) {
    // 1. Strict role gate — workspace_owner only.
    const ownerMembership = await this.prisma.membership.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: 'workspace_owner' },
      select: { id: true },
    });
    if (!ownerMembership) {
      throw new ForbiddenException(
        'building deletion requires the workspace_owner role',
      );
    }

    const building = await this.prisma.building.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
    });
    if (!building) throw new NotFoundException('building not found');

    // 2. Confirmation phrase — must match the building name verbatim
    //    (after trim). This is the "spontaneous typing" guard: a slip-of-the
    //    -finger or a stale URL bookmark cannot trigger destruction.
    const expected = building.name.trim();
    const got = (body?.confirmText ?? '').trim();
    if (got !== expected) {
      throw new BadRequestException(
        `confirmText must match the building name exactly: "${expected}"`,
      );
    }

    // Snapshot for audit + return value — these counts disappear after delete.
    const [
      floorCount,
      unitCount,
      assetCount,
      taskCount,
      cleaningRequestCount,
      incidentCount,
      serviceRequestCount,
      workOrderCount,
      documentCount,
      roleAssignmentCount,
    ] = await Promise.all([
      this.prisma.buildingFloor.count({ where: { tenantId, buildingId: building.id } }),
      this.prisma.buildingUnit.count({ where: { tenantId, buildingId: building.id } }),
      this.prisma.asset.count({ where: { tenantId, buildingId: building.id } }),
      this.prisma.taskInstance.count({ where: { tenantId, buildingId: building.id } }),
      this.prisma.cleaningRequest.count({ where: { tenantId, buildingId: building.id } }),
      this.prisma.incident.count({ where: { tenantId, buildingId: building.id } }),
      this.prisma.serviceRequest.count({ where: { tenantId, buildingId: building.id } }),
      this.prisma.workOrder.count({ where: { tenantId, buildingId: building.id } }),
      this.prisma.document.count({ where: { tenantId, buildingId: building.id } }),
      this.prisma.buildingRoleAssignment.count({
        where: { tenantId, buildingId: building.id },
      }),
    ]);
    const deletedSummary = {
      floors: floorCount,
      units: unitCount,
      assets: assetCount,
      tasks: taskCount,
      cleaningRequests: cleaningRequestCount,
      incidents: incidentCount,
      serviceRequests: serviceRequestCount,
      workOrders: workOrderCount,
      documents: documentCount,
      buildingRoleAssignments: roleAssignmentCount,
    };

    // 3. Pre-audit: write the destruction event WHILE the building still
    //    exists, so audit row binds buildingId before the FK SetNull fires.
    //    Sensitive=true — destruction is always sensitive.
    await this.audit.write({
      tenantId,
      buildingId: building.id,
      actor: actorUserId,
      role: 'workspace_owner',
      action: 'Building permanently deleted',
      entity: building.slug,
      entityType: 'building',
      building: building.name,
      ip: '127.0.0.1',
      sensitive: true,
      eventType: 'building.deleted',
      resourceType: 'building',
      resourceId: building.id,
      metadata: {
        deletedSummary,
        retainedAt: 'tenant: User, ContractorCompany, AssetType, PpmTemplate (catalogue), DocumentTemplate, audit_entries',
        confirmTextMatched: true,
      },
    });

    // 4. Delete. FK cascade walks the per-building children. Audit rows
    //    survive thanks to `onDelete: SetNull` on AuditEntry.buildingId.
    //    A long-form transaction not needed — Prisma's delete is atomic
    //    at the DB level, and either the cascade succeeds or it throws.
    //    We extend the timeout because portfolio-scale buildings can
    //    have tens of thousands of cascading rows.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.building.delete({ where: { id: building.id } });
      },
      { maxWait: 30000, timeout: 120000 },
    );

    return {
      ok: true,
      deleted: {
        buildingId: building.id,
        slug: building.slug,
        name: building.name,
      },
      deletedSummary,
      retained: {
        message:
          'tenant-shared resources kept: users, contractor companies, asset-type catalogue, PPM template catalogue, document templates, audit trail (buildingId nulled)',
      },
    };
  }

  // Set the operational status of a building. Other modules (takeover, etc.)
  // must call this instead of writing building.status directly.
  async setStatus(tenantId: string, buildingId: string, status: string) {
    const b = await this.prisma.building.findFirst({ where: { id: buildingId, tenantId } });
    if (!b) throw new NotFoundException('building not found');
    return this.prisma.building.update({ where: { id: buildingId }, data: { status } });
  }

  // Denormalized "is currently leased" flag on parking/storage. Building-core
  // owns these tables; leases module must route through this method.
  async setLeasedFlag(
    tenantId: string,
    targetType: 'parking_spot' | 'storage_unit',
    targetId: string,
    isLeased: boolean,
  ) {
    if (targetType === 'parking_spot') {
      return this.prisma.parkingSpot.update({ where: { id: targetId }, data: { isLeased } });
    }
    return this.prisma.storageUnit.update({ where: { id: targetId }, data: { isLeased } });
  }
}
