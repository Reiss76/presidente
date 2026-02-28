import { Module } from '@nestjs/common';
import { ImageSearchController } from './image-search.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [ImageSearchController],
  providers: [PrismaService],
})
export class ImageSearchModule {}
