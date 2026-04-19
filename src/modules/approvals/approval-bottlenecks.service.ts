import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApprovalBottlenecksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Snapshot of pending approval-step wait times per (role, threshold).
   * - count: how many steps pending
   * - avgWaitHours / maxWaitHours
   * - overSlaCount: steps waiting > 48h (default SLA)
   */
  async snapshot(tenantId: string, params: { buildingId?: string; defaultSlaHours?: number } = {}) {
    const sla = params.defaultSlaHours ?? 48;
    const requests = await this.prisma.approvalRequest.findMany({
      where: { tenantId, status: 'pending', ...(params.buildingId ? { buildingId: params.buildingId } : {}) },
      include: { steps: true, building: { select: { id: true, name: true, slug: true } } },
    });
    const byRole = new Map<string, { count: number; waits: number[]; buildings: Set<string>; thresholds: Set<string> }>();
    const byThreshold = new Map<string, { count: number; waits: number[] }>();
    const now = Date.now();
    const oldestPending: Array<{ requestId: string; building: string; role: string; threshold: string | null; waitHours: number; title: string }> = [];

    for (const r of requests) {
      const pending = r.steps.find((s) => s.status === 'pending');
      if (!pending) continue;
      const waited = pending.waitingSinceAt ?? pending.createdAt;
      const hours = Math.max(0, (now - new Date(waited).getTime()) / 3_600_000);

      const rAcc = byRole.get(pending.role) ?? { count: 0, waits: [], buildings: new Set(), thresholds: new Set() };
      rAcc.count += 1;
      rAcc.waits.push(hours);
      if (r.building?.name) rAcc.buildings.add(r.building.name);
      if (r.threshold) rAcc.thresholds.add(r.threshold);
      byRole.set(pending.role, rAcc);

      const tKey = r.threshold ?? 'unclassified';
      const tAcc = byThreshold.get(tKey) ?? { count: 0, waits: [] };
      tAcc.count += 1;
      tAcc.waits.push(hours);
      byThreshold.set(tKey, tAcc);

      oldestPending.push({
        requestId: r.id,
        building: r.building?.name || 'Unknown',
        role: pending.role,
        threshold: r.threshold,
        waitHours: Math.round(hours * 10) / 10,
        title: r.title,
      });
    }

    oldestPending.sort((a, b) => b.waitHours - a.waitHours);

    const roleRows = [...byRole.entries()].map(([role, acc]) => {
      const waits = acc.waits;
      const avg = waits.length ? waits.reduce((s, x) => s + x, 0) / waits.length : 0;
      const max = waits.length ? Math.max(...waits) : 0;
      const overSla = waits.filter((w) => w > sla).length;
      return {
        role,
        pendingCount: acc.count,
        avgWaitHours: Math.round(avg * 10) / 10,
        maxWaitHours: Math.round(max * 10) / 10,
        overSlaCount: overSla,
        buildings: [...acc.buildings],
        thresholds: [...acc.thresholds],
      };
    }).sort((a, b) => b.overSlaCount - a.overSlaCount || b.pendingCount - a.pendingCount);

    const thresholdRows = [...byThreshold.entries()].map(([threshold, acc]) => {
      const avg = acc.waits.length ? acc.waits.reduce((s, x) => s + x, 0) / acc.waits.length : 0;
      return { threshold, pendingCount: acc.count, avgWaitHours: Math.round(avg * 10) / 10 };
    }).sort((a, b) => b.pendingCount - a.pendingCount);

    return {
      slaHours: sla,
      totalPending: requests.filter((r) => r.steps.some((s) => s.status === 'pending')).length,
      byRole: roleRows,
      byThreshold: thresholdRows,
      oldestPending: oldestPending.slice(0, 20),
    };
  }
}
