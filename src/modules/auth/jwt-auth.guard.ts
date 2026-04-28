import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice(7);

    // TODO: replace with real OIDC/JWT validation against Auth0 or Keycloak JWKS
    if (!token || token.length < 10) {
      throw new UnauthorizedException('Invalid token');
    }

    request.user = {
      sub: 'dev-user',
      email: 'dev@domera.local',
    };

    request.tenantId = request.headers['x-tenant-id'] || null;
    return true;
  }
}
