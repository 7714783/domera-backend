import { BadRequestException, Body, Controller, Get, Headers, HttpException, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { rateLimit } from '../../common/rate-limit';
import { PublicQrService } from './public-qr.service';

const LANDING_WINDOW_MS = 60_000;
const LANDING_MAX_PER_IP = 60;
const SUBMIT_WINDOW_MS = 10 * 60_000;
const SUBMIT_MAX_PER_IP = 20;
const SUBMIT_MAX_PER_QR = 40;

function clientIp(req: Request): string {
  const h = (req.headers['x-forwarded-for'] as string) || '';
  return (h.split(',')[0] || req.ip || req.socket.remoteAddress || 'unknown').trim();
}

function baseUrlFromHost(req: Request, appBaseEnv?: string): string {
  if (appBaseEnv) return appBaseEnv;
  const proto = (req.headers['x-forwarded-proto'] as string) || (req.secure ? 'https' : 'http');
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

@Controller('public/qr')
export class PublicQrController {
  constructor(private readonly qr: PublicQrService) {}

  @Get(':qrId')
  async landing(@Param('qrId') qrId: string, @Req() req: Request) {
    const ip = clientIp(req);
    const rl = rateLimit({ key: `qr:landing:${ip}`, windowMs: LANDING_WINDOW_MS, max: LANDING_MAX_PER_IP });
    if (!rl.allowed) throw new HttpException({ error: 'rate limited', retryAfterMs: rl.retryAfterMs }, HttpStatus.TOO_MANY_REQUESTS);
    return this.qr.getLanding(qrId);
  }

  @Post(':qrId/service-requests')
  async submit(@Param('qrId') qrId: string, @Body() body: any, @Req() req: Request) {
    const ip = clientIp(req);
    const ipRl = rateLimit({ key: `qr:submit:ip:${ip}`, windowMs: SUBMIT_WINDOW_MS, max: SUBMIT_MAX_PER_IP });
    if (!ipRl.allowed) throw new HttpException({ error: 'rate limited (ip)', retryAfterMs: ipRl.retryAfterMs }, HttpStatus.TOO_MANY_REQUESTS);
    const qrRl = rateLimit({ key: `qr:submit:qr:${qrId}`, windowMs: SUBMIT_WINDOW_MS, max: SUBMIT_MAX_PER_QR });
    if (!qrRl.allowed) throw new HttpException({ error: 'rate limited (qr)', retryAfterMs: qrRl.retryAfterMs }, HttpStatus.TOO_MANY_REQUESTS);
    return this.qr.submit(qrId, body);
  }

  @Get(':qrId/png')
  async png(
    @Param('qrId') raw: string,
    @Req() req: Request,
    @Res() res: Response,
    @Query('base') base?: string,
  ) {
    const qrId = raw.endsWith('.png') ? raw.slice(0, -4) : raw;
    const ip = clientIp(req);
    const rl = rateLimit({ key: `qr:png:${ip}`, windowMs: 60_000, max: 120 });
    if (!rl.allowed) throw new HttpException({ error: 'rate limited' }, HttpStatus.TOO_MANY_REQUESTS);
    const buf = await this.qr.qrPngBuffer(qrId, base || baseUrlFromHost(req, process.env.APP_PUBLIC_BASE_URL));
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  }
}
