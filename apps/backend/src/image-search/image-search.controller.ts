import {
  BadRequestException,
  Controller,
  InternalServerErrorException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as Tesseract from 'tesseract.js'; // 👈 importante: import * as
import { PrismaService } from '../prisma.service';

// Regex para códigos PL/... (PL/123, PL/123/ABC, etc)
const CODE_REGEX = /PL\/\d{1,10}(?:\/[A-Z0-9]+)*/g;

@Controller()
export class ImageSearchController {
  constructor(private prisma: PrismaService) {}

  @Post('image-search')
  @UseInterceptors(FileInterceptor('file'))
  async searchFromImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No se recibió archivo');
    }

    // De momento solo imágenes; PDF requeriría otro flujo (convertir a imagen)
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException(
        'Por ahora solo se aceptan imágenes (JPG, PNG, etc.)'
      );
    }

    try {
      const buffer = file.buffer;

      // 1. OCR con Tesseract
      const result = await (Tesseract as any).recognize(buffer, 'eng', {
        logger: () => {},
      });

      const text: string = result?.data?.text || '';

      // 2. Buscar códigos PL/... en el texto
      const matches = text.match(CODE_REGEX) ?? [];
      const codes = Array.from(new Set(matches)); // únicos

      // Si no hay códigos, regresamos solo el texto
      if (codes.length === 0) {
        return {
          text,
          codes: [],
          results: [],
        };
      }

      // 3. Consulta en BD (Neon)
      const results = await this.prisma.codes.findMany({
        where: {
          code: {
            in: codes,
          },
        },
      });

      return {
        text,
        codes,
        results,
      };
    } catch (err) {
      console.error('Error en /image-search:', err);
      throw new InternalServerErrorException(
        'No se pudo procesar la imagen. Intenta con otra foto más clara.'
      );
    }
  }
}
