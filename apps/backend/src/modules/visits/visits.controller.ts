import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { VisitsService } from './visits.service';

type VisitType = 'verificacion' | 'calibracion' | 'supervision' | 'cateo';

@Controller()
export class VisitsController {
  constructor(private readonly service: VisitsService) {}

  // =========================
  // VISITAS por CÓDIGO
  // =========================

  @Post('codes/:codeId/visits')
  createVisit(
    @Param('codeId') codeId: string,
    @Body('visit_date') visit_date: string,
    @Body('visit_type') visit_type: VisitType,
    @Body('notes') notes?: string,
  ) {
    return this.service.createVisit(BigInt(codeId), visit_date, visit_type, notes);
  }

  @Get('codes/:codeId/visits')
  listVisitsForCode(
    @Param('codeId') codeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: VisitType,
  ) {
    return this.service.listVisitsForCode(BigInt(codeId), { from, to, type });
  }

  @Delete('codes/:codeId/visits/:visitId')
  deleteVisit(
    @Param('codeId') codeId: string,
    @Param('visitId') visitId: string,
  ) {
    return this.service.deleteVisit(BigInt(codeId), BigInt(visitId));
  }

  // =========================
  // LISTADO GLOBAL (mapa/filtros)
  // =========================

  @Get('visits')
  searchVisits(
    @Query('preset') preset?: string,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('visit_type') visit_type?: VisitType,
    @Query('usuario') usuario?: string,
    @Query('grupo_id') grupo_id?: string,
    @Query('include_baja') include_baja?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.searchVisits({
      preset,
      month,
      from,
      to,
      visit_type,
      usuario,
      grupo_id: grupo_id ? Number(grupo_id) : undefined,
      include_baja: include_baja === 'true',
      limit: limit ? Math.min(5000, Math.max(1, Number(limit))) : 500,
    });
  }

  // =========================
  // ARCHIVOS POR VISITA
  // =========================

  @Post('codes/:codeId/visits/:visitId/files/presign')
  presignVisitFile(
    @Param('codeId') codeId: string,
    @Param('visitId') visitId: string,
    @Body('fileName') fileName: string,
    @Body('contentType') contentType: string,
    @Body('size') size: number,
  ) {
    return this.service.presignVisitFile(BigInt(codeId), BigInt(visitId), fileName, contentType, size);
  }

  @Get('codes/:codeId/visits/:visitId/files')
  listVisitFiles(
    @Param('codeId') codeId: string,
    @Param('visitId') visitId: string,
  ) {
    return this.service.listVisitFiles(BigInt(codeId), BigInt(visitId));
  }

  @Delete('codes/:codeId/visits/:visitId/files/:fileId')
  deleteVisitFile(
    @Param('codeId') codeId: string,
    @Param('visitId') visitId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.service.deleteVisitFile(BigInt(codeId), BigInt(visitId), BigInt(fileId));
  }

  @Get('codes/:codeId/visits/:visitId/files/:fileId/download')
  async downloadVisitFile(
    @Param('codeId') codeId: string,
    @Param('visitId') visitId: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.service.streamVisitFile(BigInt(codeId), BigInt(visitId), BigInt(fileId));

    res.setHeader('Content-Type', data.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(data.fileName)}"`);

    data.stream.on('end', () => {
      try { res.end(); } catch {}
    });

    data.stream.pipe(res);
  }
}
