import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// 🔄 Cambio mínimo agregado para forzar deploy (comentario significativo)
// Módulo de autenticación: controla login de usuarios para CosmosX.

@Module({
  controllers: [AuthController],
  providers: [AuthService, PrismaService],
})
export class AuthModule {}
