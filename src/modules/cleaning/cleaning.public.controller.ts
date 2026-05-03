import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { rateLimit } from '../../common/rate-limit';
import { CleaningQrService } from './cleaning.qr.service';
import { CleaningRequestService } from './cleaning.request.service';
import { MigratorPrismaService } from '../../prisma/prisma.migrator';

@Controller('public/cleaning')
export class CleaningPublicController {
  constructor(
    private readonly qr: CleaningQrService,
    private readonly reqSvc: CleaningRequestService,
    private readonly prisma: MigratorPrismaService,
  ) {}

  @Get('qr/:code')
  async resolve(@Param('code') code: string) {
    if (!code || code.length < 4 || code.length > 24) throw new BadRequestException('invalid code');
    const rl = rateLimit({ key: `cleaning_qr_get:${code}`, windowMs: 60_000, max: 60 });
    if (!rl.allowed) throw new ForbiddenException('rate limit exceeded');
    return this.qr.resolvePublic(code);
  }

  @Post('qr/:code/request')
  async submit(
    @Param('code') code: string,
    @Body()
    body: {
      title: string;
      description?: string;
      category: string;
      priority?: string;
      guestName?: string;
      guestPhone?: string;
    },
    @Req() req: Request,
  ) {
    if (!code || code.length < 4 || code.length > 24) throw new BadRequestException('invalid code');
    const ip = (req.ip || req.socket.remoteAddress || 'anon').toString();
    const rl = rateLimit({ key: `cleaning_qr_post:${code}:${ip}`, windowMs: 60_000, max: 5 });
    if (!rl.allowed) throw new ForbiddenException('too many submissions — try again later');

    const qrPoint = await this.prisma.cleaningQrPoint.findUnique({ where: { code } });
    if (!qrPoint || !qrPoint.isActive) throw new BadRequestException('QR not active');

    return this.reqSvc.publicCreate({
      tenantId: qrPoint.tenantId,
      buildingId: qrPoint.buildingId,
      zoneId: qrPoint.zoneId,
      qrPointId: qrPoint.id,
      title: body.title,
      description: body.description,
      category: body.category,
      priority: body.priority,
      guestName: body.guestName,
      guestPhone: body.guestPhone,
    });
  }
}
