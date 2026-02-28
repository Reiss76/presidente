import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.login(dto);

    if (!user) {
      return {
        ok: false,
        message: 'Usuario o contraseña incorrectos.',
      };
    }

    return {
      ok: true,
      user,
    };
  }
}
