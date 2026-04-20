import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PpmService } from '../ppm/ppm.service';

const LIFECYCLE_STATUSES = ['planned', 'active', 'standby', 'out_of_service', 'obsolete', 'disposed'];
const CONDITION_STATES = ['good', 'fair', 'poor', 'critical'];
const RISK_LEVELS = ['low', 'medium', 'high', 'life_safety', 'mission_critical'];
const ASSET_LEVELS = ['system', 'subsystem', 'unit', 'component', 'group', 'zone'];
const SYSTEM_FAMILIES = [
  'HVAC', 'Electrical', 'Water', 'Drainage', 'Fire', 'FireSuppression', 'Lift',
  'BMS', 'RenewableEnergy', 'Comms', 'Security', 'AccessControl',
  'Lighting', 'StructuralMonitoring', 'Roof', 'Envelope', 'Glazing',
  'Finishes', 'Flooring', 'Waterproofing', 'Sanitary', 'Service', 'Waste', 'Storage', 'Workshop', 'Other',
];

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ppm: PpmService,
  ) {}

  private async resolveBuildingId(tenantId: string, idOrSlug: string): Promise<string> {
    const b = await this.prisma.building.findFirst({
      where: { tenantId, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      select: { id: true },
    });
    if (!b) throw new NotFoundException('building not found');
    return b.id;
  }

  // ── Registry ─────────────────────────────────────────
  async list(tenantId: string, buildingIdOrSlug: string, params: {
    systemFamily?: string; assetLevel?: string; assetTypeId?: string;
    riskCriticality?: string; lifecycleStatus?: string; conditionState?: string;
    locationId?: string; search?: string; take?: number; skip?: number;
    ppmOverdueOnly?: boolean;
  }) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const where: any = { tenantId, buildingId, isActive: true };
    for (const k of ['systemFamily', 'assetLevel', 'assetTypeId', 'riskCriticality', 'lifecycleStatus', 'conditionState', 'locationId'] as const) {
      if ((params as any)[k]) where[k] = (params as any)[k];
    }
    if (params.search) {
      const q = params.search;
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { model: { contains: q, mode: 'insensitive' } },
        { manufacturer: { contains: q, mode: 'insensitive' } },
        { serialNumber: { contains: q, mode: 'insensitive' } },
        { qrBarcode: { contains: q, mode: 'insensitive' } },
      ];
    }
    const take = Math.min(Math.max(params.take ?? 100, 1), 500);
    const skip = Math.max(params.skip ?? 0, 0);
    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({
        where, take, skip,
        orderBy: [{ systemFamily: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.asset.count({ where }),
    ]);
    return { total, items };
  }

  async get(tenantId: string, id: string) {
    const a = await this.prisma.asset.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundException('asset not found');
    const [attrs, docs, media, children, spares, assetType, location] = await Promise.all([
      this.prisma.assetCustomAttribute.findMany({ where: { assetId: id }, orderBy: { attributeKey: 'asc' } }),
      this.prisma.assetDocument.findMany({ where: { assetId: id } }),
      this.prisma.assetMedia.findMany({ where: { assetId: id } }),
      this.prisma.asset.findMany({ where: { parentAssetId: id, tenantId }, select: { id: true, name: true, systemFamily: true, assetLevel: true, serialNumber: true } }),
      this.prisma.assetSparePart.findMany({ where: { assetId: id } }),
      a.assetTypeId ? this.prisma.assetType.findUnique({ where: { id: a.assetTypeId } }) : null,
      a.locationId ? this.prisma.buildingLocation.findUnique({ where: { id: a.locationId } }) : null,
    ]);
    return { ...a, customAttributes: attrs, documents: docs, media, children, spareParts: spares, assetType, location };
  }

  // ── Create / update ───────────────────────────────────
  async create(tenantId: string, actorUserId: string, buildingIdOrSlug: string, body: any) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    this.validateCreateBody(body);
    if (body.assetTypeId) {
      const at = await this.prisma.assetType.findFirst({ where: { id: body.assetTypeId, tenantId, isActive: true } });
      if (!at) throw new NotFoundException('asset type not found');
      if (at.isSerialized && !body.serialNumber && body.assetLevel === 'unit') {
        throw new BadRequestException(`asset type "${at.name}" is serialized — serialNumber is required for a unit`);
      }
      body.systemFamily = body.systemFamily || at.systemFamily;
    }
    if (body.locationId) {
      const loc = await this.prisma.buildingLocation.findFirst({ where: { id: body.locationId, tenantId, buildingId } });
      if (!loc) throw new NotFoundException('location not found in this building');
    }
    // Enforce unique qrBarcode only when supplied
    if (body.qrBarcode) {
      const clash = await this.prisma.asset.findUnique({ where: { qrBarcode: body.qrBarcode } });
      if (clash) throw new BadRequestException('QR/barcode already taken');
    }
    const created = await this.prisma.asset.create({
      data: {
        tenantId, buildingId,
        name: body.name,
        class: body.class || body.systemFamily || 'asset',
        systemType: body.systemType || null,
        systemFamily: body.systemFamily || null,
        assetTypeId: body.assetTypeId || null,
        assetLevel: body.assetLevel || 'unit',
        parentAssetId: body.parentAssetId || null,
        locationId: body.locationId || null,
        qrBarcode: body.qrBarcode || null,
        model: body.model || null,
        manufacturer: body.manufacturer || null,
        manufacturerPartNo: body.manufacturerPartNo || null,
        serialNumber: body.serialNumber || null,
        installDate: body.installDate ? new Date(body.installDate) : null,
        commissioningDate: body.commissioningDate ? new Date(body.commissioningDate) : null,
        warrantyStart: body.warrantyStart ? new Date(body.warrantyStart) : null,
        warrantyEnd: body.warrantyEnd ? new Date(body.warrantyEnd) : null,
        attributes: body.attributes ?? undefined,
        lifecycleStatus: body.lifecycleStatus || 'active',
        conditionState: body.conditionState || 'good',
        riskCriticality: body.riskCriticality || 'medium',
        responsibleDepartment: body.responsibleDepartment || null,
        responsibleUserId: body.responsibleUserId || null,
        purchaseCost: body.purchaseCost ?? null,
        replacementCost: body.replacementCost ?? null,
        contractId: body.contractId || null,
        slaId: body.slaId || null,
        haystackTags: body.haystackTags || [],
        brickClass: body.brickClass || null,
        brickRelations: body.brickRelations ?? undefined,
        externalIds: body.externalIds ?? undefined,
        ifcGuid: body.ifcGuid || null,
        createdBy: actorUserId,
      },
    });
    await this.audit.write({
      tenantId, actor: actorUserId, role: 'asset_manager',
      action: 'asset.created', entity: created.id, entityType: 'asset',
      building: buildingId, ip: '-', sensitive: false,
    });
    return created;
  }

  async update(tenantId: string, actorUserId: string, id: string, body: any) {
    const a = await this.prisma.asset.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundException('asset not found');
    const data: any = {};
    for (const k of [
      'name', 'class', 'systemType', 'systemFamily', 'assetTypeId', 'assetLevel',
      'parentAssetId', 'locationId', 'qrBarcode',
      'model', 'manufacturer', 'manufacturerPartNo', 'serialNumber',
      'lifecycleStatus', 'conditionState', 'riskCriticality',
      'responsibleDepartment', 'responsibleUserId',
      'purchaseCost', 'replacementCost', 'contractId', 'slaId',
      'brickClass', 'ifcGuid',
    ]) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    for (const k of ['installDate', 'commissioningDate', 'warrantyStart', 'warrantyEnd']) {
      if (body[k] !== undefined) data[k] = body[k] ? new Date(body[k]) : null;
    }
    for (const k of ['attributes', 'brickRelations', 'externalIds']) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    if (body.haystackTags !== undefined) data.haystackTags = body.haystackTags;
    // Validation: enum fields
    if (data.lifecycleStatus && !LIFECYCLE_STATUSES.includes(data.lifecycleStatus)) throw new BadRequestException('invalid lifecycleStatus');
    if (data.conditionState && !CONDITION_STATES.includes(data.conditionState)) throw new BadRequestException('invalid conditionState');
    if (data.riskCriticality && !RISK_LEVELS.includes(data.riskCriticality)) throw new BadRequestException('invalid riskCriticality');
    if (data.assetLevel && !ASSET_LEVELS.includes(data.assetLevel)) throw new BadRequestException('invalid assetLevel');
    const updated = await this.prisma.asset.update({ where: { id }, data });
    await this.audit.write({
      tenantId, actor: actorUserId, role: 'asset_manager',
      action: 'asset.updated', entity: id, entityType: 'asset',
      building: a.buildingId, ip: '-', sensitive:
        !!(data.lifecycleStatus || data.riskCriticality || data.locationId || data.contractId),
    });
    return updated;
  }

  async softDelete(tenantId: string, actorUserId: string, id: string) {
    const a = await this.prisma.asset.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundException('asset not found');
    await this.prisma.asset.update({ where: { id }, data: { isActive: false, lifecycleStatus: 'disposed' } });
    await this.audit.write({
      tenantId, actor: actorUserId, role: 'asset_manager',
      action: 'asset.archived', entity: id, entityType: 'asset',
      building: a.buildingId, ip: '-', sensitive: true,
    });
    return { ok: true };
  }

  // ── Custom attributes ─────────────────────────────────
  async setCustomAttribute(tenantId: string, assetId: string, body: { attributeKey: string; value: any; valueType?: string }) {
    const a = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId } });
    if (!a) throw new NotFoundException('asset not found');
    if (!body.attributeKey) throw new BadRequestException('attributeKey required');
    return this.prisma.assetCustomAttribute.upsert({
      where: { assetId_attributeKey: { assetId, attributeKey: body.attributeKey } },
      create: {
        tenantId, assetId,
        attributeKey: body.attributeKey,
        valueType: body.valueType || 'string',
        valueJson: body.value as any,
      },
      update: {
        valueType: body.valueType || 'string',
        valueJson: body.value as any,
      },
    });
  }

  async removeCustomAttribute(tenantId: string, assetId: string, attributeKey: string) {
    const row = await this.prisma.assetCustomAttribute.findFirst({ where: { tenantId, assetId, attributeKey } });
    if (!row) throw new NotFoundException('attribute not found');
    await this.prisma.assetCustomAttribute.delete({ where: { id: row.id } });
    return { ok: true };
  }

  // ── Documents ─────────────────────────────────────────
  async attachDocument(tenantId: string, assetId: string, body: { documentId: string; docType: string; title?: string; version?: string }) {
    const a = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId } });
    if (!a) throw new NotFoundException('asset not found');
    if (!body.documentId || !body.docType) throw new BadRequestException('documentId and docType required');
    const doc = await this.prisma.document.findFirst({ where: { id: body.documentId, tenantId } });
    if (!doc) throw new NotFoundException('document not found');
    return this.prisma.assetDocument.upsert({
      where: { assetId_documentId_docType: { assetId, documentId: body.documentId, docType: body.docType } },
      create: {
        tenantId, assetId,
        documentId: body.documentId,
        docType: body.docType,
        title: body.title || null,
        version: body.version || null,
      },
      update: { title: body.title, version: body.version },
    });
  }

  async detachDocument(tenantId: string, assetDocumentId: string) {
    const row = await this.prisma.assetDocument.findFirst({ where: { id: assetDocumentId, tenantId } });
    if (!row) throw new NotFoundException('asset-document link not found');
    await this.prisma.assetDocument.delete({ where: { id: assetDocumentId } });
    return { ok: true };
  }

  // ── Media ─────────────────────────────────────────────
  async attachMedia(tenantId: string, assetId: string, body: { mediaType: string; documentId?: string; url?: string; caption?: string }) {
    const a = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId } });
    if (!a) throw new NotFoundException('asset not found');
    if (!body.mediaType) throw new BadRequestException('mediaType required');
    if (!body.documentId && !body.url) throw new BadRequestException('documentId or url required');
    return this.prisma.assetMedia.create({
      data: {
        tenantId, assetId,
        mediaType: body.mediaType,
        documentId: body.documentId || null,
        url: body.url || null,
        caption: body.caption || null,
      },
    });
  }

  async removeMedia(tenantId: string, mediaId: string) {
    const row = await this.prisma.assetMedia.findFirst({ where: { id: mediaId, tenantId } });
    if (!row) throw new NotFoundException('media not found');
    await this.prisma.assetMedia.delete({ where: { id: mediaId } });
    return { ok: true };
  }

  // ── Bulk import (CSV-flavoured JSON) ──────────────────
  async bulkImport(tenantId: string, actorUserId: string, buildingIdOrSlug: string, body: { items: any[]; validateOnly?: boolean }) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const errors: Array<{ row: number; error: string }> = [];
    const validated: any[] = [];
    (body.items || []).forEach((raw, idx) => {
      try {
        this.validateCreateBody(raw);
        validated.push(raw);
      } catch (e: any) {
        errors.push({ row: idx, error: e?.message || 'invalid row' });
      }
    });
    if (body.validateOnly) {
      return { valid: validated.length, errors, total: (body.items || []).length };
    }
    let created = 0;
    for (const row of validated) {
      try {
        await this.create(tenantId, actorUserId, buildingId, row);
        created++;
      } catch (e: any) {
        errors.push({ row: -1, error: e?.message || 'create failed' });
      }
    }
    return { created, errors, total: (body.items || []).length };
  }

  // ── Asset types ───────────────────────────────────────
  async listAssetTypes(tenantId: string, systemFamily?: string) {
    const where: any = { tenantId, isActive: true };
    if (systemFamily) where.systemFamily = systemFamily;
    return this.prisma.assetType.findMany({ where, orderBy: [{ systemFamily: 'asc' }, { name: 'asc' }] });
  }

  async createAssetType(tenantId: string, body: { key: string; name: string; systemFamily: string; isSerialized?: boolean; description?: string; schemaKey?: string }) {
    if (!body.key || !body.name || !body.systemFamily) {
      throw new BadRequestException('key, name, systemFamily required');
    }
    if (!SYSTEM_FAMILIES.includes(body.systemFamily)) {
      throw new BadRequestException(`systemFamily must be one of ${SYSTEM_FAMILIES.join(', ')}`);
    }
    return this.prisma.assetType.upsert({
      where: { tenantId_key: { tenantId, key: body.key } },
      create: {
        tenantId,
        key: body.key,
        name: body.name,
        systemFamily: body.systemFamily,
        isSerialized: body.isSerialized ?? true,
        description: body.description || null,
        schemaKey: body.schemaKey || null,
      },
      update: {
        name: body.name, systemFamily: body.systemFamily,
        isSerialized: body.isSerialized ?? true,
        description: body.description || null,
        schemaKey: body.schemaKey || null,
        isActive: true,
      },
    });
  }

  // ── Validation ────────────────────────────────────────
  private validateCreateBody(body: any) {
    if (!body) throw new BadRequestException('body required');
    if (!body.name) throw new BadRequestException('name required');
    if (body.assetLevel && !ASSET_LEVELS.includes(body.assetLevel)) throw new BadRequestException('invalid assetLevel');
    if (body.lifecycleStatus && !LIFECYCLE_STATUSES.includes(body.lifecycleStatus)) throw new BadRequestException('invalid lifecycleStatus');
    if (body.conditionState && !CONDITION_STATES.includes(body.conditionState)) throw new BadRequestException('invalid conditionState');
    if (body.riskCriticality && !RISK_LEVELS.includes(body.riskCriticality)) throw new BadRequestException('invalid riskCriticality');
    if (body.systemFamily && !SYSTEM_FAMILIES.includes(body.systemFamily)) throw new BadRequestException(`invalid systemFamily`);
    // Unit-level assets with a typed serialized template must carry a serial.
    if ((body.assetLevel || 'unit') === 'unit' && body.isSerialized === true && !body.serialNumber) {
      throw new BadRequestException('unit-level serialized assets require serialNumber');
    }
    // Fire & lift: require riskCriticality + responsibleDepartment for safety of ops.
    if (body.systemFamily === 'Fire' || body.systemFamily === 'Lift') {
      if (!body.riskCriticality) throw new BadRequestException(`${body.systemFamily} assets require riskCriticality`);
      if (!body.responsibleDepartment) throw new BadRequestException(`${body.systemFamily} assets require responsibleDepartment`);
    }
  }

  // ── Semantic tags (Haystack + Brick) ──────────────────
  // Called by building-core's tagAsset endpoint. Assets owns the row; keeping
  // the write here guarantees a single writer to the assets table.
  async setSemanticTags(tenantId: string, assetId: string, buildingId: string, body: {
    haystackTags?: string[]; brickClass?: string; brickRelations?: unknown; externalIds?: unknown;
  }) {
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId, buildingId } });
    if (!asset) throw new NotFoundException('asset not found in this building');
    return this.prisma.asset.update({
      where: { id: assetId },
      data: {
        haystackTags: body.haystackTags ?? asset.haystackTags,
        brickClass: body.brickClass ?? asset.brickClass,
        brickRelations: body.brickRelations === undefined ? (asset as any).brickRelations : (body.brickRelations as any),
        externalIds: body.externalIds === undefined ? (asset as any).externalIds : (body.externalIds as any),
      },
    });
  }

  // ── PPM linkage ───────────────────────────────────────
  // AssetsService validates the asset, then delegates the write to PpmService
  // (the owner of ppm_plan_items). Audit entries are written here because the
  // ACTION is initiated by the asset module (actor role = asset_manager).
  async listPpm(tenantId: string, assetId: string) {
    const a = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true, buildingId: true } });
    if (!a) throw new NotFoundException('asset not found');
    return this.ppm.listPlanItemsForAsset(tenantId, assetId, a.buildingId);
  }

  async attachPpm(tenantId: string, actorUserId: string, assetId: string, planItemId: string) {
    const a = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true, buildingId: true } });
    if (!a) throw new NotFoundException('asset not found');
    const updated = await this.ppm.attachPlanItemToAsset(tenantId, planItemId, assetId, a.buildingId);
    await this.audit.write({
      tenantId, actor: actorUserId, role: 'asset_manager',
      action: 'ppm.plan_item.attach_asset',
      entity: planItemId, entityType: 'ppm_plan_item',
      building: a.buildingId, ip: '-', sensitive: false,
    });
    return updated;
  }

  async detachPpm(tenantId: string, actorUserId: string, assetId: string, planItemId: string) {
    const updated = await this.ppm.detachPlanItemFromAsset(tenantId, planItemId, assetId);
    await this.audit.write({
      tenantId, actor: actorUserId, role: 'asset_manager',
      action: 'ppm.plan_item.detach_asset',
      entity: planItemId, entityType: 'ppm_plan_item',
      building: updated.buildingId, ip: '-', sensitive: false,
    });
    return updated;
  }
}
