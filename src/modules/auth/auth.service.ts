import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma/prisma.service';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-domera-secret-change-me';
const JWT_TTL_SECONDS = 60 * 60 * 24 * 7;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private sign(user: { id: string; username: string | null; isSuperAdmin: boolean }) {
    return jwt.sign(
      { sub: user.id, username: user.username, superadmin: user.isSuperAdmin },
      JWT_SECRET,
      { expiresIn: JWT_TTL_SECONDS },
    );
  }

  verify(token: string): { sub: string; username: string | null; superadmin: boolean } | null {
    try {
      return jwt.verify(token, JWT_SECRET) as any;
    } catch {
      return null;
    }
  }

  async register(body: { username: string; password: string; email?: string; displayName?: string }) {
    if (!body.username || body.username.length < 3) throw new BadRequestException('username too short');
    if (!body.password || body.password.length < 8) throw new BadRequestException('password too short');

    const existing = await this.prisma.user.findUnique({ where: { username: body.username } });
    if (existing) throw new ConflictException('username already taken');

    const email = (body.email || `${body.username.toLowerCase()}@users.local`).toLowerCase();
    const emailConflict = await this.prisma.user.findUnique({ where: { emailNormalized: email } });
    if (emailConflict) throw new ConflictException('email already taken');

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await this.prisma.user.create({
      data: {
        username: body.username,
        email,
        emailNormalized: email,
        passwordHash,
        displayName: body.displayName || body.username,
        status: 'active',
        createdBy: 'register',
      },
    });

    const token = this.sign(user);
    return {
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName, email: user.email, isSuperAdmin: user.isSuperAdmin },
    };
  }

  async login(body: { username: string; password: string }) {
    if (!body.username || !body.password) throw new BadRequestException('username and password required');

    const user = await this.prisma.user.findUnique({ where: { username: body.username } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('invalid credentials');

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = this.sign(user);
    return {
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName, email: user.email, isSuperAdmin: user.isSuperAdmin },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, displayName: true, email: true, isSuperAdmin: true, status: true,
        organizationMemberships: { include: { organization: { select: { id: true, name: true, slug: true, tenantId: true, type: true } } } },
        buildingRoles: { include: { building: { select: { id: true, name: true, slug: true, tenantId: true } }, role: { select: { key: true, name: true } } } },
      },
    });
    if (!user) throw new UnauthorizedException('user not found');
    return user;
  }
}
