import { Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() body: { username: string; password: string; email?: string; displayName?: string }) {
    return this.auth.register(body);
  }

  @Post('login')
  login(@Body() body: { username: string; password: string }) {
    return this.auth.login(body);
  }

  @Get('me')
  async me(@Headers('authorization') auth?: string) {
    if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
    const payload = this.auth.verify(auth.slice(7));
    if (!payload) throw new UnauthorizedException('invalid token');
    return this.auth.me(payload.sub);
  }
}
