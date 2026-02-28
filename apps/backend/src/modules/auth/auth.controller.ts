import { Body, Controller, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

type RateBucket = { count: number; resetAt: number };

@Controller('auth')
export class AuthController {
  private readonly loginAttempts = new Map<string, RateBucket>();
  private readonly MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 10);
  private readonly WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000);

  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Req() req: any, @Body() dto: LoginDto) {
    const key = this.getRateKey(req, dto?.username ?? 'unknown');
    const now = Date.now();
    const bucket = this.loginAttempts.get(key);

    if (bucket && bucket.resetAt > now && bucket.count >= this.MAX_ATTEMPTS) {
      throw new HttpException(
        'Demasiados intentos de login. Intenta más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.authService.login(dto);

    if (!user) {
      this.registerFailedAttempt(key, now);
      return {
        ok: false,
        message: 'Usuario o contraseña incorrectos.',
      };
    }

    this.loginAttempts.delete(key);

    return {
      ok: true,
      user,
    };
  }

  private getRateKey(req: any, username: string) {
    const ip =
      req?.headers?.['x-forwarded-for']?.toString().split(',')[0].trim() ||
      req?.ip ||
      'unknown-ip';
    return `${ip}:${String(username || '').toLowerCase()}`;
  }

  private registerFailedAttempt(key: string, now: number) {
    const prev = this.loginAttempts.get(key);
    if (!prev || prev.resetAt <= now) {
      this.loginAttempts.set(key, { count: 1, resetAt: now + this.WINDOW_MS });
      return;
    }

    this.loginAttempts.set(key, {
      count: prev.count + 1,
      resetAt: prev.resetAt,
    });
  }
}
