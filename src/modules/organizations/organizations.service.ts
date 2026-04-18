import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface OrganizationItem {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  buildings: number;
  members: number;
  compliance: number;
  status: 'healthy' | 'watch' | 'risk';
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<OrganizationItem[]> {
    const organizations = await this.prisma.organization.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: {
            buildings: true,
            memberships: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return organizations.map((org) => ({
      id: org.id,
      tenantId: org.tenantId,
      name: org.name,
      type: org.type,
      buildings: org._count.buildings,
      members: org._count.memberships,
      compliance: org.compliance,
      status: (org.status as 'healthy' | 'watch' | 'risk') || 'watch',
    }));
  }
}
