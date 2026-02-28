import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaService } from './prisma.service';
import { AppController } from './app.controller';

import { AuthModule } from './modules/auth/auth.module';
import { CodesModule } from './modules/codes/codes.module';
import { FilesModule } from './modules/files/files.module';
import { VisitsModule } from './modules/visits/visits.module'; // ✅ NUEVO
import { AdminModule } from './modules/admin/admin.module';
import { PlModule } from './modules/pl/pl.module'; // ✅ Maps module
import { GroupsModule } from './modules/groups/groups.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    CodesModule,
    FilesModule,
    VisitsModule, // ✅ REGISTRADO AQUÍ
    AdminModule,
    PlModule, // ✅ MAPS MODULE
    GroupsModule,
  ],
  controllers: [AppController],
  providers: [PrismaService],
})
export class AppModule {}
