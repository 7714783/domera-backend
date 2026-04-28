import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type MovementType = 'receipt' | 'issue' | 'transfer' | 'adjustment' | 'return' | 'write_off';
const VALID_TYPES: MovementType[] = [
  'receipt',
  'issue',
  'transfer',
  'adjustment',
  'return',
  'write_off',
];

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Items ──────────────────────────────────────────────
  async listItems(tenantId: string) {
    return this.prisma.inventoryItem.findMany({
      where: { tenantId },
      orderBy: { sku: 'asc' },
    });
  }

  async upsertItem(
    tenantId: string,
    body: {
      sku: string;
      name: string;
      category?: string;
      uom?: string;
      alternates?: string[];
      minLevel?: number;
      maxLevel?: number;
      reorderLevel?: number;
      description?: string;
      isActive?: boolean;
    },
  ) {
    if (!body.sku || !body.name) throw new BadRequestException('sku + name required');
    return this.prisma.inventoryItem.upsert({
      where: { tenantId_sku: { tenantId, sku: body.sku } },
      create: {
        tenantId,
        sku: body.sku,
        name: body.name,
        category: body.category || null,
        uom: body.uom || 'piece',
        alternates: body.alternates || [],
        minLevel: body.minLevel ?? null,
        maxLevel: body.maxLevel ?? null,
        reorderLevel: body.reorderLevel ?? null,
        description: body.description || null,
        isActive: body.isActive ?? true,
      },
      update: {
        name: body.name,
        category: body.category || null,
        uom: body.uom || 'piece',
        alternates: body.alternates || [],
        minLevel: body.minLevel ?? null,
        maxLevel: body.maxLevel ?? null,
        reorderLevel: body.reorderLevel ?? null,
        description: body.description || null,
        isActive: body.isActive ?? true,
      },
    });
  }

  // ── Locations ──────────────────────────────────────────
  async listLocations(tenantId: string) {
    return this.prisma.stockLocation.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    });
  }

  async upsertLocation(
    tenantId: string,
    body: { code: string; name: string; buildingId?: string; kind?: string; isActive?: boolean },
  ) {
    if (!body.code || !body.name) throw new BadRequestException('code + name required');
    return this.prisma.stockLocation.upsert({
      where: { tenantId_code: { tenantId, code: body.code } },
      create: {
        tenantId,
        code: body.code,
        name: body.name,
        buildingId: body.buildingId || null,
        kind: body.kind || 'storeroom',
        isActive: body.isActive ?? true,
      },
      update: {
        name: body.name,
        buildingId: body.buildingId || null,
        kind: body.kind || 'storeroom',
        isActive: body.isActive ?? true,
      },
    });
  }

  // ── Balances ───────────────────────────────────────────
  /** Compute on-hand balance for (item × location) from StockMovement history. */
  async balance(tenantId: string, filter?: { itemId?: string; locationId?: string }) {
    const movements = await this.prisma.stockMovement.findMany({
      where: { tenantId, itemId: filter?.itemId || undefined },
      select: {
        itemId: true,
        fromLocationId: true,
        toLocationId: true,
        quantity: true,
        movementType: true,
      },
    });
    const map = new Map<string, { itemId: string; locationId: string; qty: number }>();
    const add = (itemId: string, locationId: string | null, delta: number) => {
      if (!locationId) return;
      if (filter?.locationId && filter.locationId !== locationId) return;
      const key = `${itemId}|${locationId}`;
      const cur = map.get(key) || { itemId, locationId, qty: 0 };
      cur.qty += delta;
      map.set(key, cur);
    };
    for (const m of movements) {
      if (
        m.movementType === 'receipt' ||
        m.movementType === 'return' ||
        m.movementType === 'adjustment'
      ) {
        add(m.itemId, m.toLocationId, m.quantity);
      } else if (m.movementType === 'issue' || m.movementType === 'write_off') {
        add(m.itemId, m.fromLocationId, -m.quantity);
      } else if (m.movementType === 'transfer') {
        add(m.itemId, m.fromLocationId, -m.quantity);
        add(m.itemId, m.toLocationId, m.quantity);
      }
    }
    return [...map.values()].sort((a, b) => a.itemId.localeCompare(b.itemId));
  }

  async balanceForItem(tenantId: string, itemId: string): Promise<number> {
    const rows = await this.balance(tenantId, { itemId });
    return rows.reduce((a, r) => a + r.qty, 0);
  }

  async balanceAt(tenantId: string, itemId: string, locationId: string): Promise<number> {
    const rows = await this.balance(tenantId, { itemId, locationId });
    return rows.reduce((a, r) => a + r.qty, 0);
  }

  // ── Movements ──────────────────────────────────────────
  async listMovements(
    tenantId: string,
    filter?: { itemId?: string; workOrderId?: string; limit?: number },
  ) {
    return this.prisma.stockMovement.findMany({
      where: {
        tenantId,
        itemId: filter?.itemId || undefined,
        workOrderId: filter?.workOrderId || undefined,
      },
      orderBy: { occurredAt: 'desc' },
      take: filter?.limit || 200,
    });
  }

  async recordMovement(
    tenantId: string,
    actorUserId: string,
    body: {
      itemSku: string;
      quantity: number;
      movementType: MovementType;
      fromLocationCode?: string;
      toLocationCode?: string;
      workOrderId?: string;
      taskInstanceId?: string;
      purchaseOrderId?: string;
      unitCost?: number;
      reason?: string;
      occurredAt?: string;
    },
  ) {
    if (!body.itemSku || !body.movementType || !body.quantity)
      throw new BadRequestException('itemSku, movementType, quantity required');
    if (!VALID_TYPES.includes(body.movementType))
      throw new BadRequestException(`movementType must be one of ${VALID_TYPES.join('|')}`);
    if (body.quantity <= 0) throw new BadRequestException('quantity must be > 0');

    const item = await this.prisma.inventoryItem.findFirst({
      where: { tenantId, sku: body.itemSku },
    });
    if (!item) throw new NotFoundException(`item sku ${body.itemSku} not found`);

    const [fromLoc, toLoc] = await Promise.all([
      body.fromLocationCode
        ? this.prisma.stockLocation.findFirst({ where: { tenantId, code: body.fromLocationCode } })
        : null,
      body.toLocationCode
        ? this.prisma.stockLocation.findFirst({ where: { tenantId, code: body.toLocationCode } })
        : null,
    ]);

    // Movement-specific validation
    switch (body.movementType) {
      case 'receipt':
      case 'return':
      case 'adjustment':
        if (!toLoc) throw new BadRequestException(`${body.movementType} requires toLocationCode`);
        break;
      case 'issue':
      case 'write_off':
        if (!fromLoc)
          throw new BadRequestException(`${body.movementType} requires fromLocationCode`);
        break;
      case 'transfer':
        if (!fromLoc || !toLoc)
          throw new BadRequestException('transfer requires fromLocationCode + toLocationCode');
        if (fromLoc.id === toLoc.id)
          throw new BadRequestException('transfer locations must differ');
        break;
    }

    // Balance guard (no negative on hand for issue/transfer/write_off)
    if (['issue', 'transfer', 'write_off'].includes(body.movementType) && fromLoc) {
      const balance = await this.balanceAt(tenantId, item.id, fromLoc.id);
      if (balance < body.quantity) {
        throw new BadRequestException(
          `insufficient stock at ${fromLoc.code}: on hand ${balance}, requested ${body.quantity}`,
        );
      }
    }

    const totalCost = body.unitCost !== undefined ? body.unitCost * body.quantity : null;

    return this.prisma.stockMovement.create({
      data: {
        tenantId,
        itemId: item.id,
        quantity: body.quantity,
        movementType: body.movementType,
        fromLocationId: fromLoc?.id || null,
        toLocationId: toLoc?.id || null,
        workOrderId: body.workOrderId || null,
        taskInstanceId: body.taskInstanceId || null,
        purchaseOrderId: body.purchaseOrderId || null,
        unitCost: body.unitCost ?? null,
        totalCost,
        reason: body.reason || null,
        actorUserId,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      },
    });
  }

  // ── Reconciliation ─────────────────────────────────────
  async reconciliation(tenantId: string) {
    const [items, locations, balances] = await Promise.all([
      this.prisma.inventoryItem.findMany({ where: { tenantId } }),
      this.prisma.stockLocation.findMany({ where: { tenantId } }),
      this.balance(tenantId),
    ]);
    const byItem = new Map<string, { onHand: number; below_min: boolean; reorder: boolean }>();
    for (const it of items) byItem.set(it.id, { onHand: 0, below_min: false, reorder: false });
    for (const b of balances) {
      const cur = byItem.get(b.itemId);
      if (cur) cur.onHand += b.qty;
    }
    const report = items.map((it) => {
      const s = byItem.get(it.id)!;
      return {
        itemId: it.id,
        sku: it.sku,
        name: it.name,
        uom: it.uom,
        onHand: s.onHand,
        minLevel: it.minLevel,
        reorderLevel: it.reorderLevel,
        needsReorder: it.reorderLevel != null && s.onHand <= it.reorderLevel,
        belowMin: it.minLevel != null && s.onHand < it.minLevel,
      };
    });
    return {
      tenantId,
      asOf: new Date().toISOString(),
      itemsCount: items.length,
      locationsCount: locations.length,
      belowMin: report.filter((r) => r.belowMin).length,
      needsReorder: report.filter((r) => r.needsReorder).length,
      items: report.sort((a, b) => a.sku.localeCompare(b.sku)),
    };
  }
}
