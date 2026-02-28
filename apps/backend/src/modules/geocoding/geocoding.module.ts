import { Module } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';
import { GeocodingController } from './geocoding.controller';
import { PrismaService } from '../../prisma.service';

@Module({ providers: [GeocodingService, PrismaService], controllers: [GeocodingController] })
export class GeocodingModule {}
