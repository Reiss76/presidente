import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CodesController } from './codes.controller';
import { CodesService } from './codes.service';
import { GeocodingService } from '../geocoding/geocoding.service';

@Module({
  controllers: [CodesController],
  providers: [CodesService, PrismaService, GeocodingService],
})
export class CodesModule {}
