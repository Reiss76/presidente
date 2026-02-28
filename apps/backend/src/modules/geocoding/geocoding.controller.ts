import { Controller, Param, Post } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';

@Controller('codes/:id/geocode')
export class GeocodingController {
  constructor(private service: GeocodingService) {}
  @Post()
  geocode(@Param('id') id: string) {
    return this.service.geocode(BigInt(id));
  }
}
