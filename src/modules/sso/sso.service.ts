import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeJwtPayload(jwt: string): any {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('invalid jwt');
  const pad = (s: string) => s + '==='.slice((s.length + 3) % 4);
  const json = Buffer.from(pad(parts[1]).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json);
}

@Injectable()
export class SsoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  // ── Admin: IdP registration ────────────────────────────
  async listProviders(tenantId: string) {
    return this.prisma.identityProvider.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, key: true, displayName: true, protocol: true,
        issuerUrl: true, clientId: true, scopes: true, emailClaim: true,
        nameClaim: true, groupClaim: true, isActive: true, createdAt: true,
      },
    });
  }

  async upsertProvider(tenantId: string, actorUserId: string, body: {
    key: string; displayName: string; protocol?: string;
    issuerUrl?: string; clientId?: string; clientSecret?: string;
    scopes?: string[]; authorizationEndpoint?: string; tokenEndpoint?: string;
    userinfoEndpoint?: string; jwksUri?: string;
    samlMetadataUrl?: string; samlEntityId?: string;
    emailClaim?: string; nameClaim?: string; groupClaim?: string;
    isActive?: boolean;
  }) {
    if (!body.key || !body.displayName) throw new BadRequestException('key and displayName required');
    const protocol = body.protocol || 'oidc';
    if (!['oidc', 'saml'].includes(protocol)) throw new BadRequestException('protocol must be oidc|saml');
    if (protocol === 'oidc' && (!body.issuerUrl || !body.clientId || !body.clientSecret)) {
      throw new BadRequestException('oidc requires issuerUrl, clientId, clientSecret');
    }
    const row = await this.prisma.identityProvider.upsert({
      where: { tenantId_key: { tenantId, key: body.key } },
      create: {
        tenantId, key: body.key, displayName: body.displayName, protocol,
        issuerUrl: body.issuerUrl || null,
        clientId: body.clientId || null,
        clientSecret: body.clientSecret || null,
        scopes: body.scopes && body.scopes.length > 0 ? body.scopes : ['openid', 'email', 'profile'],
        authorizationEndpoint: body.authorizationEndpoint || null,
        tokenEndpoint: body.tokenEndpoint || null,
        userinfoEndpoint: body.userinfoEndpoint || null,
        jwksUri: body.jwksUri || null,
        samlMetadataUrl: body.samlMetadataUrl || null,
        samlEntityId: body.samlEntityId || null,
        emailClaim: body.emailClaim || 'email',
        nameClaim: body.nameClaim || 'name',
        groupClaim: body.groupClaim || null,
        isActive: body.isActive ?? true,
        createdByUserId: actorUserId,
      },
      update: {
        displayName: body.displayName,
        issuerUrl: body.issuerUrl ?? undefined,
        clientId: body.clientId ?? undefined,
        clientSecret: body.clientSecret ?? undefined,
        scopes: body.scopes ?? undefined,
        authorizationEndpoint: body.authorizationEndpoint ?? undefined,
        tokenEndpoint: body.tokenEndpoint ?? undefined,
        userinfoEndpoint: body.userinfoEndpoint ?? undefined,
        jwksUri: body.jwksUri ?? undefined,
        emailClaim: body.emailClaim ?? undefined,
        nameClaim: body.nameClaim ?? undefined,
        groupClaim: body.groupClaim ?? undefined,
        isActive: body.isActive ?? undefined,
      },
    });
    await this.audit.write({
      tenantId, actor: actorUserId, role: 'workspace_admin',
      action: 'sso.provider.upserted', entity: row.id, entityType: 'identity_provider',
      building: '-', ip: '-', sensitive: true,
    });
    return { ...row, clientSecret: undefined };
  }

  // ── OIDC flow: /authorize → /callback ───────────────────
  async buildAuthorizeUrl(tenantId: string, providerKey: string, redirectTo: string, frontendBaseUrl: string) {
    const provider = await this.prisma.identityProvider.findFirst({
      where: { tenantId, key: providerKey, isActive: true, protocol: 'oidc' },
    });
    if (!provider) throw new NotFoundException('OIDC provider not found or inactive');
    if (!provider.authorizationEndpoint || !provider.clientId) {
      throw new BadRequestException('provider missing authorizationEndpoint or clientId');
    }

    const state = b64url(randomBytes(16));
    const nonce = b64url(randomBytes(16));
    const codeVerifier = b64url(randomBytes(32));
    const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());

    await this.prisma.oidcLoginState.create({
      data: {
        tenantId,
        providerId: provider.id,
        state,
        nonce,
        codeVerifier,
        redirectTo,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const cbUri = `${frontendBaseUrl}/v1/sso/callback`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: provider.clientId,
      redirect_uri: cbUri,
      scope: provider.scopes.join(' '),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return { authorizeUrl: `${provider.authorizationEndpoint}?${params.toString()}`, state };
  }

  async handleCallback(code: string, state: string, redirectUri: string, tenantId: string) {
    const login = await this.prisma.oidcLoginState.findUnique({ where: { state } });
    if (!login) throw new UnauthorizedException('unknown state');
    if (login.expiresAt.getTime() < Date.now()) {
      await this.prisma.oidcLoginState.delete({ where: { id: login.id } });
      throw new UnauthorizedException('state expired');
    }
    if (login.tenantId !== tenantId) throw new UnauthorizedException('tenant mismatch');

    const provider = await this.prisma.identityProvider.findUnique({ where: { id: login.providerId } });
    if (!provider || !provider.tokenEndpoint || !provider.clientId || !provider.clientSecret) {
      throw new BadRequestException('provider mis-configured for token exchange');
    }

    // Exchange code for tokens
    const tokenRes = await fetch(provider.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        code_verifier: login.codeVerifier,
      }).toString(),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new UnauthorizedException(`token endpoint error: ${tokenRes.status} ${body.slice(0, 200)}`);
    }
    const tokens: any = await tokenRes.json();
    const idToken = tokens.id_token;
    const accessToken = tokens.access_token;
    if (!idToken && !accessToken) throw new UnauthorizedException('no id_token or access_token');

    // Parse id_token payload (signature verification against jwksUri is
    // delegated to the provider for first pass; production MUST verify).
    const claims: any = idToken ? decodeJwtPayload(idToken) : {};

    // Enrich with /userinfo when provider exposes it
    let userinfo: any = null;
    if (provider.userinfoEndpoint && accessToken) {
      const ui = await fetch(provider.userinfoEndpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (ui.ok) userinfo = await ui.json();
    }

    const merged = { ...claims, ...(userinfo || {}) };
    const email = (merged[provider.emailClaim] || merged.email || '').toLowerCase();
    const displayName = merged[provider.nameClaim] || merged.name || email;
    const subject = merged.sub || (userinfo && userinfo.sub);
    if (!email || !subject) throw new UnauthorizedException('id_token missing email or sub');

    // Link or create user
    const existing = await this.prisma.federatedIdentity.findUnique({
      where: { providerId_subject: { providerId: provider.id, subject } },
    });
    let user;
    if (existing) {
      user = await this.prisma.user.update({
        where: { id: existing.userId },
        data: { lastLoginAt: new Date() },
      });
      await this.prisma.federatedIdentity.update({
        where: { id: existing.id },
        data: { lastLoginAt: new Date(), rawClaims: merged as any, email, displayName },
      });
    } else {
      user = await this.prisma.user.upsert({
        where: { emailNormalized: email },
        create: {
          email, emailNormalized: email,
          displayName, status: 'active', lastLoginAt: new Date(),
        },
        update: { lastLoginAt: new Date() },
      });
      await this.prisma.federatedIdentity.create({
        data: {
          userId: user.id, providerId: provider.id, subject,
          email, displayName, rawClaims: merged as any, lastLoginAt: new Date(),
        },
      });
      // Ensure the user has a baseline membership in this tenant
      const mem = await this.prisma.membership.findFirst({ where: { tenantId, userId: user.id } });
      if (!mem) {
        await this.prisma.membership.create({
          data: { tenantId, userId: user.id, roleKey: 'workspace_member' },
        });
      }
    }

    const issued = await this.auth.issueSession(user.id, { source: 'sso', providerKey: provider.key });

    await this.prisma.oidcLoginState.delete({ where: { id: login.id } });
    await this.audit.write({
      tenantId, actor: user.id, role: 'sso',
      action: `sso.login.${provider.key}`, entity: user.id, entityType: 'user',
      building: '-', ip: '-', sensitive: true,
    });

    return {
      token: issued.token,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      redirectTo: login.redirectTo,
    };
  }
}
