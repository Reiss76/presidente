import { Module } from '@nestjs/common';
import { PlController } from './pl.controller';
import { PlService } from './pl.service';
import { PrismaService } from '../../prisma.service';
import { GeocodingService } from '../geocoding/geocoding.service';

@Module({
  controllers: [PlController],
  providers: [PlService, PrismaService, GeocodingService],
  exports: [PlService],
})
export class PlModule {}
