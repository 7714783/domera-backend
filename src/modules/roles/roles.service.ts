// INIT-013 — Role catalogue.
//
// System roles (24 of them, seeded by prisma/seeds/seed-reference.mjs)
// have tenantId IS NULL and isCustom = FALSE. They are immutable from
// the API: workspace_owner can READ them, CLONE them as a starting
// point for a custom role, but never EDIT or DELETE.
//
// Custom roles are tenantId-scoped (one tenant's custom roles are
// invisible to others). Custom keys are namespaced as
//   `t_<tenantSlug>_<userKey>`
// to avoid colliding with the global system role keys.
//
// Categories drive the role-builder UI: a custom role declares a list
// of MODULE_CATEGORIES it touches; the UI then surfaces the permissions
// of every backend module whose MODULE_CATEGORY is in that list.

import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isModuleCategory } from '../../common/module-categories';

export interface RoleCreate {
  key: string; // user-facing slug, system normalises it
  name: string;
  description?: string;
  scope: 'workspace' | 'organization' | 'building' | 'project';
  categories: string[];
  permissions: string[];
  iconKey?: string;
  maxDelegatableScope?: 'workspace' | 'organization' | 'building' | 'project' | null;
}

// key is immutable after creation; change name/description instead.
export type RoleUpdate = Partial<Omit<RoleCreate, 'key'>>;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // List roles visible to this tenant: every system role + every custom
  // role owned by this tenant. Custom roles from OTHER tenants are not
  // returned.
  async list(tenantId: string) {
    const roles = await this.prisma.role.findMany({
      where: {
        OR: [{ tenantId: null }, { tenantId }],
      },
      include: { permissions: true },
      orderBy: [{ isCustom: 'asc' }, { name: 'asc' }],
    });
    return {
      total: roles.length,
      items: roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        scope: r.scope,
        maxDelegatableScope: r.maxDelegatableScope,
        tenantId: r.tenantId,
        isCustom: r.isCustom,
        description: r.description,
        categories: r.categories,
        iconKey: r.iconKey,
        permissions: r.permissions.map((p) => p.permission),
      })),
    };
  }

  async getOne(tenantId: string, key: string) {
    const r = await this.prisma.role.findUnique({
      where: { key },
      include: { permissions: true },
    });
    if (!r) throw new NotFoundException('role not found');
    if (r.tenantId && r.tenantId !== tenantId) {
      throw new NotFoundException('role not found');
    }
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      scope: r.scope,
      maxDelegatableScope: r.maxDelegatableScope,
      tenantId: r.tenantId,
      isCustom: r.isCustom,
      description: r.description,
      categories: r.categories,
      iconKey: r.iconKey,
      permissions: r.permissions.map((p) => p.permission),
    };
  }

  async create(tenantId: string, actor: string, body: RoleCreate) {
    if (!body.name?.trim()) throw new BadRequestException('name required');
    if (!body.scope) throw new BadRequestException('scope required');
    for (const c of body.categories ?? []) {
      if (!isModuleCategory(c)) {
        throw new BadRequestException(`unknown category: ${c}`);
      }
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('tenant not found');

    const userPart = body.key ? slugify(body.key) : slugify(body.name);
    const key = `t_${tenant.slug.replace(/[^a-z0-9]+/g, '')}_${userPart}`;
    const dup = await this.prisma.role.findUnique({ where: { key } });
    if (dup) throw new ConflictException('role with this key already exists');

    const created = await this.prisma.role.create({
      data: {
        key,
        name: body.name.trim(),
        scope: body.scope,
        maxDelegatableScope: body.maxDelegatableScope ?? null,
        tenantId,
        isCustom: true,
        description: body.description ?? null,
        categories: body.categories ?? [],
        iconKey: body.iconKey ?? null,
        permissions: {
          create: (body.permissions ?? []).map((p) => ({ permission: p })),
        },
      },
      include: { permissions: true },
    });

    await this.audit.write({
      tenantId,
      buildingId: null,
      actor,
      role: 'workspace',
      action: 'role.created',
      entity: created.key,
      entityType: 'role',
      building: '',
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'role.created',
      resourceType: 'role',
      resourceId: created.id,
      metadata: { categories: body.categories, permissionCount: (body.permissions ?? []).length },
    });
    return {
      id: created.id,
      key: created.key,
      name: created.name,
      scope: created.scope,
      maxDelegatableScope: created.maxDelegatableScope,
      tenantId: created.tenantId,
      isCustom: created.isCustom,
      description: created.description,
      categories: created.categories,
      iconKey: created.iconKey,
      permissions: created.permissions.map((p) => p.permission),
    };
  }

  // Edit a CUSTOM role. System roles are immutable. Permissions can be
  // replaced wholesale (we delete & re-create RolePermission rows in a
  // transaction).
  async update(tenantId: string, actor: string, key: string, body: RoleUpdate) {
    const r = await this.prisma.role.findUnique({
      where: { key },
      include: { permissions: true },
    });
    if (!r) throw new NotFoundException('role not found');
    if (!r.isCustom) throw new ForbiddenException('system roles are immutable');
    if (r.tenantId !== tenantId) throw new ForbiddenException('role belongs to another tenant');

    if (body.categories) {
      for (const c of body.categories) {
        if (!isModuleCategory(c)) throw new BadRequestException(`unknown category: ${c}`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const data: any = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.description !== undefined) data.description = body.description;
      if (body.scope !== undefined) data.scope = body.scope;
      if (body.categories !== undefined) data.categories = body.categories;
      if (body.iconKey !== undefined) data.iconKey = body.iconKey;
      if (body.maxDelegatableScope !== undefined) data.maxDelegatableScope = body.maxDelegatableScope;

      const updated = await tx.role.update({ where: { key }, data });

      if (body.permissions !== undefined) {
        await tx.rolePermission.deleteMany({ where: { roleKey: key } });
        if (body.permissions.length) {
          await tx.rolePermission.createMany({
            data: body.permissions.map((p) => ({ roleKey: key, permission: p })),
          });
        }
      }

      await this.audit.write({
        tenantId,
        buildingId: null,
        actor,
        role: 'workspace',
        action: 'role.updated',
        entity: updated.key,
        entityType: 'role',
        building: '',
        ip: '127.0.0.1',
        sensitive: false,
        eventType: 'role.updated',
        resourceType: 'role',
        resourceId: updated.id,
        metadata: { fields: Object.keys(data), permissionsReplaced: body.permissions !== undefined },
      });

      const permissions = body.permissions !== undefined
        ? body.permissions
        : r.permissions.map((p) => p.permission);
      return {
        id: updated.id,
        key: updated.key,
        name: updated.name,
        scope: updated.scope,
        maxDelegatableScope: updated.maxDelegatableScope,
        tenantId: updated.tenantId,
        isCustom: updated.isCustom,
        description: updated.description,
        categories: updated.categories,
        iconKey: updated.iconKey,
        permissions,
      };
    });
  }

  // Delete a CUSTOM role IFF no active assignments exist. System roles
  // can never be deleted.
  async remove(tenantId: string, actor: string, key: string) {
    const r = await this.prisma.role.findUnique({ where: { key } });
    if (!r) throw new NotFoundException('role not found');
    if (!r.isCustom) throw new ForbiddenException('system roles cannot be deleted');
    if (r.tenantId !== tenantId) throw new ForbiddenException('role belongs to another tenant');

    const activeGrants = await (this.prisma as any).teamMemberRoleAssignment.count({
      where: {
        tenantId,
        roleKey: key,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (activeGrants > 0) {
      throw new ConflictException(`cannot delete: ${activeGrants} active assignments`);
    }

    await this.prisma.role.delete({ where: { key } });

    await this.audit.write({
      tenantId,
      buildingId: null,
      actor,
      role: 'workspace',
      action: 'role.deleted',
      entity: key,
      entityType: 'role',
      building: '',
      ip: '127.0.0.1',
      sensitive: true,
      eventType: 'role.deleted',
      resourceType: 'role',
      resourceId: r.id,
    });
    return { ok: true };
  }

  // Clone a system role as a brand-new custom role. Useful starting
  // point — workspace_owner clones "technician" then trims permissions.
  async clone(tenantId: string, actor: string, sourceKey: string, body: { name: string }) {
    const src = await this.prisma.role.findUnique({
      where: { key: sourceKey },
      include: { permissions: true },
    });
    if (!src) throw new NotFoundException('source role not found');
    if (src.tenantId && src.tenantId !== tenantId) {
      throw new ForbiddenException('cannot clone a role from another tenant');
    }
    return this.create(tenantId, actor, {
      key: body.name,
      name: body.name,
      description: src.description ?? `Cloned from ${src.name}`,
      scope: src.scope as RoleCreate['scope'],
      maxDelegatableScope: (src.maxDelegatableScope ?? null) as RoleCreate['maxDelegatableScope'],
      categories: src.categories,
      iconKey: src.iconKey ?? undefined,
      permissions: src.permissions.map((p) => p.permission),
    });
  }
}
