import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type Predicate = { attr: string; op: string; value: number | string };

@Injectable()
export class ApplicabilityService {
  constructor(private readonly prisma: PrismaService) {}

  evaluate(predicate: Predicate, ctx: Record<string, number | string | null | undefined>): boolean {
    const v = ctx[predicate.attr];
    if (v === null || v === undefined) return false;
    switch (predicate.op) {
      case '>':
        return Number(v) > Number(predicate.value);
      case '>=':
        return Number(v) >= Number(predicate.value);
      case '<':
        return Number(v) < Number(predicate.value);
      case '<=':
        return Number(v) <= Number(predicate.value);
      case '=':
      case '==':
        return String(v) === String(predicate.value);
      case '!=':
        return String(v) !== String(predicate.value);
      default:
        return false;
    }
  }

  async buildingContext(buildingId: string): Promise<Record<string, number | string | null>> {
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) return {};
    const ctx: Record<string, number | string | null> = {
      'building.floors_count': building.floorsCount ?? null,
      'building.annual_kwh': building.annualKwh ?? null,
      'building.country_code': building.countryCode,
    };
    const assets = await this.prisma.asset.findMany({ where: { buildingId } });
    const coolingTons = assets
      .map((a) => {
        const extra = (a as any).attributes as { cooling_tons?: number } | null;
        return extra?.cooling_tons || 0;
      })
      .reduce((a, b) => Math.max(a, b), 0);
    ctx['asset.cooling_tons'] = coolingTons || null;
    return ctx;
  }

  async applyTemplatesToBuilding(
    tenantId: string,
    buildingId: string,
  ): Promise<{ applied: number; skipped: number }> {
    const templates = await this.prisma.obligationTemplate.findMany({
      where: { tenantId },
      include: { applicabilityRules: true },
    });
    const ctx = await this.buildingContext(buildingId);

    let applied = 0;
    let skipped = 0;
    for (const tpl of templates) {
      const rules = tpl.applicabilityRules;
      const allPass =
        rules.length === 0 || rules.every((r) => this.evaluate(r.predicate as any, ctx));
      if (!allPass) {
        skipped += 1;
        continue;
      }

      const seedKey = `bo:auto:${tpl.id}:${buildingId}`;
      await this.prisma.buildingObligation.upsert({
        where: { seedKey },
        create: {
          tenantId,
          buildingId,
          obligationTemplateId: tpl.id,
          complianceStatus: 'active',
          criticality: tpl.basisType === 'statutory' ? 'high' : 'medium',
          seedKey,
          createdBy: 'applicability:auto',
        },
        update: { complianceStatus: 'active' },
      });
      applied += 1;
    }
    return { applied, skipped };
  }
}
