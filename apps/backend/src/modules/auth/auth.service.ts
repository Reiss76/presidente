import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async login(dto: LoginDto) {
    const { username, password } = dto;

    // Buscar usuario por username (case-sensitive)
    const rows = await this.prisma.$queryRaw<
      { id: bigint; username: string; password: string; role: string }[]
    >`SELECT id, username, password, role 
      FROM app_users 
      WHERE username = ${username}
      LIMIT 1;`;

    if (!rows.length) {
      // Usuario no encontrado
      return null;
    }

    const row = rows[0];

    // Validar contraseña simple (SIN hashing todavía)
    if (row.password !== password) {
      return null;
    }

    // Retornar usuario en formato limpio
    return {
      id: Number(row.id),
      username: row.username,
      role: row.role,
    };
  }
}
