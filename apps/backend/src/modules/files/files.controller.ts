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
import { FilesService } from './files.service';

type FileKind = 'general' | 'cal';

@Controller('codes/:id/files')
export class FilesController {
  constructor(private readonly service: FilesService) {}

  @Post('presign')
  presign(
    @Param('id') id: string,
    @Body('fileName') fileName: string,
    @Body('contentType') contentType: string,
    @Body('size') size: number,
    @Body('kind') kind: FileKind,
  ) {
    const safeKind: FileKind = kind === 'cal' ? 'cal' : 'general';
    return this.service.presign(
      BigInt(id),
      fileName,
      contentType,
      size,
      safeKind,
    );
  }

  @Get()
  list(@Param('id') id: string, @Query('kind') kind?: FileKind) {
    const safeKind: FileKind = kind === 'cal' ? 'cal' : 'general';
    return this.service.list(BigInt(id), safeKind);
  }

  /**
   * ✅ GET /codes/:id/files/:fileId/download
   * Stream vía backend (Safari-safe).
   */
  @Get(':fileId/download')
  async download(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const data = await this.service.streamFile(BigInt(id), BigInt(fileId));

      res.setHeader(
        'Content-Type',
        data.contentType || 'application/octet-stream',
      );

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(data.fileName)}"`,
      );

      data.stream.on('error', () => {
        // si el stream falla en medio, cerramos
        if (!res.headersSent) {
          res.status(500).send('Error leyendo el archivo');
        } else {
          res.end();
        }
      });

      data.stream.on('end', () => {
        res.end();
      });

      data.stream.pipe(res);
    } catch (e: any) {
      // ✅ mensaje más claro en lugar de 500 genérico
      const msg =
        e?.message || 'Error interno descargando el archivo (streamFile)';
      res.status(400).send(msg);
    }
  }

  @Delete(':fileId')
  remove(@Param('id') id: string, @Param('fileId') fileId: string) {
    return this.service.remove(BigInt(id), BigInt(fileId));
  }
}
