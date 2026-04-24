import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const CLASSIFICATIONS = ['capex', 'opex', 'mixed'];
const LINE_CLASSIFICATIONS = ['capex', 'opex'];
const STAGE_STATUSES = ['not_started', 'in_progress', 'blocked', 'done', 'skipped'];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Project CRUD + classification ───────────────────────
  async listProjects(tenantId: string, buildingId?: string, classification?: string) {
    const where: any = { tenantId };
    if (buildingId) where.buildingId = buildingId;
    if (classification) where.classification = classification;
    return this.prisma.project.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async getProject(tenantId: string, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundException('project not found');
    const [stages, budgetLines, changeOrders, acceptance] = await Promise.all([
      this.prisma.projectStage.findMany({ where: { projectId: id }, orderBy: { orderNo: 'asc' } }),
      this.prisma.projectBudgetLine.findMany({
        where: { projectId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.changeOrder.findMany({
        where: { projectId: id },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.acceptancePack.findUnique({ where: { projectId: id } }),
    ]);
    const totals = this.rollup(budgetLines, changeOrders);
    return { ...p, stages, budgetLines, changeOrders, acceptance, totals };
  }

  private rollup(lines: any[], cos: any[]) {
    const plannedCapex = lines
      .filter((l) => l.classification === 'capex')
      .reduce((a, b) => a + b.plannedAmount, 0);
    const plannedOpex = lines
      .filter((l) => l.classification === 'opex')
      .reduce((a, b) => a + b.plannedAmount, 0);
    const actualCapex = lines
      .filter((l) => l.classification === 'capex')
      .reduce((a, b) => a + b.actualAmount, 0);
    const actualOpex = lines
      .filter((l) => l.classification === 'opex')
      .reduce((a, b) => a + b.actualAmount, 0);
    const approvedCos = cos.filter((c) => c.status === 'approved');
    const coCapex = approvedCos
      .filter((c) => c.classification === 'capex')
      .reduce((a, b) => a + b.costDelta, 0);
    const coOpex = approvedCos
      .filter((c) => c.classification === 'opex')
      .reduce((a, b) => a + b.costDelta, 0);
    return {
      plannedCapex,
      plannedOpex,
      actualCapex,
      actualOpex,
      coCapex,
      coOpex,
      totalPlanned: plannedCapex + plannedOpex + coCapex + coOpex,
      totalActual: actualCapex + actualOpex,
    };
  }

  async createProject(
    tenantId: string,
    actorUserId: string,
    body: {
      buildingId: string;
      name: string;
      stage?: string;
      capexBudgetId?: string;
      recommendationId?: string;
      classification?: string;
      classificationReason?: string;
    },
  ) {
    if (!body.buildingId || !body.name)
      throw new BadRequestException('buildingId and name required');
    if (body.classification && !CLASSIFICATIONS.includes(body.classification)) {
      throw new BadRequestException(`classification must be one of ${CLASSIFICATIONS.join(', ')}`);
    }
    const project = await this.prisma.project.create({
      data: {
        tenantId,
        buildingId: body.buildingId,
        name: body.name,
        stage: body.stage || 'initiation',
        capexBudgetId: body.capexBudgetId || null,
        recommendationId: body.recommendationId || null,
        classification: body.classification || 'capex',
        classificationReason: body.classificationReason || null,
        stageHistory: [
          { stage: body.stage || 'initiation', at: new Date().toISOString(), by: actorUserId },
        ] as any,
      },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'project_owner',
      action: 'project.created',
      entity: project.id,
      entityType: 'project',
      building: project.buildingId,
      ip: '-',
      sensitive: false,
    });
    return project;
  }

  async classify(
    tenantId: string,
    actorUserId: string,
    id: string,
    body: { classification: string; reason?: string },
  ) {
    if (!CLASSIFICATIONS.includes(body.classification)) {
      throw new BadRequestException(`classification must be one of ${CLASSIFICATIONS.join(', ')}`);
    }
    const p = await this.prisma.project.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundException('project not found');
    if (p.classification === body.classification) return p;
    const history = Array.isArray(p.conversionHistory) ? [...(p.conversionHistory as any[])] : [];
    history.push({
      from: p.classification,
      to: body.classification,
      reason: body.reason || null,
      at: new Date().toISOString(),
      by: actorUserId,
    });
    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        classification: body.classification,
        classificationReason: body.reason || p.classificationReason,
        conversionHistory: history as any,
      },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'finance_controller',
      action: `project.classify.${p.classification}_to_${body.classification}`,
      entity: id,
      entityType: 'project',
      building: p.buildingId,
      ip: '-',
      sensitive: true,
    });
    return updated;
  }

  async advanceStage(tenantId: string, actorUserId: string, id: string, nextStage: string) {
    const p = await this.prisma.project.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundException('project not found');
    const history = Array.isArray(p.stageHistory) ? [...(p.stageHistory as any[])] : [];
    history.push({ stage: nextStage, at: new Date().toISOString(), by: actorUserId });
    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        stage: nextStage,
        stageHistory: history as any,
        closedAt: nextStage === 'closed' ? new Date() : null,
      },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'project_owner',
      action: `project.stage.${p.stage}_to_${nextStage}`,
      entity: id,
      entityType: 'project',
      building: p.buildingId,
      ip: '-',
      sensitive: false,
    });
    return updated;
  }

  // ── Stages ─────────────────────────────────────────────
  async createStage(tenantId: string, projectId: string, body: any) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, tenantId } });
    if (!p) throw new NotFoundException('project not found');
    if (!body.name || body.orderNo === undefined)
      throw new BadRequestException('name + orderNo required');
    if (body.status && !STAGE_STATUSES.includes(body.status)) {
      throw new BadRequestException(`status must be one of ${STAGE_STATUSES.join(', ')}`);
    }
    return this.prisma.projectStage.create({
      data: {
        tenantId,
        buildingId: p.buildingId,
        projectId,
        orderNo: body.orderNo,
        name: body.name,
        ownerUserId: body.ownerUserId || null,
        plannedStart: body.plannedStart ? new Date(body.plannedStart) : null,
        plannedEnd: body.plannedEnd ? new Date(body.plannedEnd) : null,
        status: body.status || 'not_started',
        acceptanceCriteria: body.acceptanceCriteria || null,
        notes: body.notes || null,
      },
    });
  }

  async updateStage(tenantId: string, stageId: string, body: any) {
    const s = await this.prisma.projectStage.findFirst({ where: { id: stageId, tenantId } });
    if (!s) throw new NotFoundException('stage not found');
    if (body.status && !STAGE_STATUSES.includes(body.status)) {
      throw new BadRequestException(`status must be one of ${STAGE_STATUSES.join(', ')}`);
    }
    const data: any = {};
    for (const k of ['name', 'ownerUserId', 'acceptanceCriteria', 'notes', 'status']) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    for (const k of ['plannedStart', 'plannedEnd', 'actualStart', 'actualEnd']) {
      if (body[k] !== undefined) data[k] = body[k] ? new Date(body[k]) : null;
    }
    return this.prisma.projectStage.update({ where: { id: stageId }, data });
  }

  // ── Budget lines ───────────────────────────────────────
  async addBudgetLine(tenantId: string, projectId: string, body: any) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, tenantId } });
    if (!p) throw new NotFoundException('project not found');
    if (!body.category || !body.description || body.plannedAmount === undefined) {
      throw new BadRequestException('category, description, plannedAmount required');
    }
    if (body.classification && !LINE_CLASSIFICATIONS.includes(body.classification)) {
      throw new BadRequestException(`classification must be capex|opex`);
    }
    return this.prisma.projectBudgetLine.create({
      data: {
        tenantId,
        buildingId: p.buildingId,
        projectId,
        stageId: body.stageId || null,
        category: body.category,
        description: body.description,
        plannedAmount: body.plannedAmount,
        actualAmount: body.actualAmount || 0,
        currency: body.currency || 'ILS',
        classification: body.classification || 'capex',
        vendorOrgId: body.vendorOrgId || null,
        purchaseOrderId: body.purchaseOrderId || null,
        notes: body.notes || null,
      },
    });
  }

  async convertLineClassification(
    tenantId: string,
    actorUserId: string,
    lineId: string,
    to: string,
    reason?: string,
  ) {
    if (!LINE_CLASSIFICATIONS.includes(to)) throw new BadRequestException('to must be capex|opex');
    const line = await this.prisma.projectBudgetLine.findFirst({ where: { id: lineId, tenantId } });
    if (!line) throw new NotFoundException('line not found');
    if (line.classification === to) return line;
    const updated = await this.prisma.projectBudgetLine.update({
      where: { id: lineId },
      data: {
        classification: to,
        notes: [
          line.notes,
          `[${new Date().toISOString()}] classification ${line.classification}→${to}${reason ? `: ${reason}` : ''}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'finance_controller',
      action: `budget_line.convert.${line.classification}_to_${to}`,
      entity: lineId,
      entityType: 'project_budget_line',
      building: line.buildingId,
      ip: '-',
      sensitive: true,
    });
    return updated;
  }

  // ── Change orders ──────────────────────────────────────
  async createChangeOrder(tenantId: string, actorUserId: string, projectId: string, body: any) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, tenantId } });
    if (!p) throw new NotFoundException('project not found');
    if (!body.coNumber || !body.title || body.costDelta === undefined) {
      throw new BadRequestException('coNumber, title, costDelta required');
    }
    return this.prisma.changeOrder.create({
      data: {
        tenantId,
        buildingId: p.buildingId,
        projectId,
        coNumber: body.coNumber,
        title: body.title,
        description: body.description || null,
        scopeDelta: body.scopeDelta || null,
        costDelta: body.costDelta,
        currency: body.currency || 'ILS',
        scheduleDeltaDays: body.scheduleDeltaDays ?? null,
        classification: body.classification || 'capex',
        requestedByUserId: actorUserId,
        approvalRequestId: body.approvalRequestId || null,
      },
    });
  }

  async decideChangeOrder(
    tenantId: string,
    actorUserId: string,
    coId: string,
    decision: 'approved' | 'rejected',
  ) {
    if (!['approved', 'rejected'].includes(decision))
      throw new BadRequestException('invalid decision');
    const co = await this.prisma.changeOrder.findFirst({ where: { id: coId, tenantId } });
    if (!co) throw new NotFoundException('change order not found');
    if (co.status !== 'pending')
      throw new BadRequestException(`cannot decide on CO in status ${co.status}`);
    if (co.requestedByUserId === actorUserId) {
      throw new ForbiddenException('SoD: requester cannot approve their own change order');
    }
    const updated = await this.prisma.changeOrder.update({
      where: { id: coId },
      data: {
        status: decision,
        approvedByUserId: actorUserId,
        approvedAt: new Date(),
      },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'project_owner',
      action: `change_order.${decision}`,
      entity: coId,
      entityType: 'change_order',
      building: co.buildingId,
      ip: '-',
      sensitive: true,
    });
    return updated;
  }

  // ── Acceptance pack / handover ─────────────────────────
  async upsertAcceptancePack(
    tenantId: string,
    projectId: string,
    body: {
      requiredDocumentTypeKeys?: string[];
    },
  ) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, tenantId } });
    if (!p) throw new NotFoundException('project not found');
    return this.prisma.acceptancePack.upsert({
      where: { projectId },
      create: {
        tenantId,
        buildingId: p.buildingId,
        projectId,
        requiredDocumentTypeKeys: body.requiredDocumentTypeKeys || [],
      },
      update: {
        requiredDocumentTypeKeys: body.requiredDocumentTypeKeys || [],
      },
    });
  }

  async submitAcceptancePack(tenantId: string, actorUserId: string, projectId: string) {
    const pack = await this.prisma.acceptancePack.findFirst({ where: { projectId, tenantId } });
    if (!pack) throw new NotFoundException('acceptance pack not found');
    if (pack.status !== 'draft')
      throw new BadRequestException(`cannot submit pack in status ${pack.status}`);

    // Verify all required documents are attached via DocumentLink (targetType='project').
    const required = pack.requiredDocumentTypeKeys || [];
    if (required.length > 0) {
      const links = await this.prisma.documentLink.findMany({
        where: { tenantId, targetType: 'project', targetId: projectId },
        select: { documentId: true },
      });
      const attachedDocs = await this.prisma.document.findMany({
        where: { tenantId, id: { in: links.map((l) => l.documentId) } },
        select: { documentTypeKey: true },
      });
      const attached = new Set(
        attachedDocs.map((d) => d.documentTypeKey).filter(Boolean) as string[],
      );
      const missing = required.filter((k) => !attached.has(k));
      if (missing.length > 0) {
        throw new BadRequestException(`missing required documents: ${missing.join(', ')}`);
      }
    }

    const updated = await this.prisma.acceptancePack.update({
      where: { id: pack.id },
      data: { status: 'submitted', submittedAt: new Date() },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'project_owner',
      action: 'acceptance_pack.submitted',
      entity: pack.id,
      entityType: 'acceptance_pack',
      building: pack.buildingId,
      ip: '-',
      sensitive: true,
    });
    return updated;
  }

  async signoffAcceptancePack(
    tenantId: string,
    actorUserId: string,
    projectId: string,
    signoff: 'contractor' | 'manager' | 'chief_engineer' | 'owner',
  ) {
    const pack = await this.prisma.acceptancePack.findFirst({ where: { projectId, tenantId } });
    if (!pack) throw new NotFoundException('acceptance pack not found');
    if (!['submitted', 'partially_signed'].includes(pack.status)) {
      throw new BadRequestException(`pack in status ${pack.status}, cannot sign off`);
    }
    // Enforce SoD: one user cannot sign two different roles on the same pack.
    const existingSignoffs = {
      contractor: pack.contractorSignoffByUserId,
      manager: pack.managerSignoffByUserId,
      chief_engineer: pack.chiefEngineerSignoffByUserId,
      owner: pack.ownerSignoffByUserId,
    };
    const conflict = Object.entries(existingSignoffs).find(
      ([role, uid]) => role !== signoff && uid === actorUserId,
    );
    if (conflict) {
      throw new ForbiddenException(
        `SoD: user already signed as ${conflict[0]}; cannot also sign as ${signoff}`,
      );
    }

    const data: any = {};
    const now = new Date();
    if (signoff === 'contractor') {
      data.contractorSignoffByUserId = actorUserId;
      data.contractorSignoffAt = now;
    }
    if (signoff === 'manager') {
      data.managerSignoffByUserId = actorUserId;
      data.managerSignoffAt = now;
    }
    if (signoff === 'chief_engineer') {
      data.chiefEngineerSignoffByUserId = actorUserId;
      data.chiefEngineerSignoffAt = now;
    }
    if (signoff === 'owner') {
      data.ownerSignoffByUserId = actorUserId;
      data.ownerSignoffAt = now;
    }

    // Determine new status: all four signed → accepted, ≥1 signed → partially_signed.
    const nextSignoffs = { ...existingSignoffs, [signoff]: actorUserId };
    const required: Array<keyof typeof nextSignoffs> = ['contractor', 'manager', 'chief_engineer'];
    const allSigned = required.every((r) => nextSignoffs[r]);
    data.status = allSigned ? 'accepted' : 'partially_signed';
    if (allSigned) data.closedAt = now;

    const updated = await this.prisma.acceptancePack.update({ where: { id: pack.id }, data });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: `acceptance_${signoff}`,
      action: `acceptance_pack.signoff.${signoff}`,
      entity: pack.id,
      entityType: 'acceptance_pack',
      building: pack.buildingId,
      ip: '-',
      sensitive: true,
    });
    return updated;
  }

  async rejectAcceptancePack(
    tenantId: string,
    actorUserId: string,
    projectId: string,
    reason: string,
  ) {
    const pack = await this.prisma.acceptancePack.findFirst({ where: { projectId, tenantId } });
    if (!pack) throw new NotFoundException('acceptance pack not found');
    if (!['submitted', 'partially_signed'].includes(pack.status)) {
      throw new BadRequestException(`cannot reject pack in status ${pack.status}`);
    }
    const updated = await this.prisma.acceptancePack.update({
      where: { id: pack.id },
      data: { status: 'rejected', rejectionReason: reason, closedAt: new Date() },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'project_owner',
      action: 'acceptance_pack.rejected',
      entity: pack.id,
      entityType: 'acceptance_pack',
      building: pack.buildingId,
      ip: '-',
      sensitive: true,
    });
    return updated;
  }
}
