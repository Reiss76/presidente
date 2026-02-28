import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { Readable } from 'stream';

type VisitType = 'verificacion' | 'calibracion' | 'supervision' | 'cateo';

/* =======================
   Helpers
======================= */

function safeVisitType(v?: string | null): VisitType | undefined {
  if (!v) return undefined;
  const t = String(v).toLowerCase();
  if (
    t === 'verificacion' ||
    t === 'calibracion' ||
    t === 'supervision' ||
    t === 'cateo'
  ) {
    return t;
  }
  return undefined;
}

function parseISODateOnly(s?: string): string | undefined {
  if (!s) return undefined;
  const v = String(s).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return v;
}

function toDateOnlyString(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseMonth(s?: string): { from: string; to: string } | undefined {
  if (!s) return undefined;
  if (!/^\d{4}-\d{2}$/.test(s)) return undefined;

  const [y, m] = s.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const to = toDateOnlyString(new Date(Date.UTC(y, m, 1)));

  return { from, to };
}

/* =======================
   Service
======================= */

@Injectable()
export class VisitsService {
  private s3: S3Client;
  private bucket: string;
  private hasS3: boolean;

  constructor(private prisma: PrismaService) {
    const bucket = process.env.R2_BUCKET || '';
    const endpoint = process.env.R2_ENDPOINT || undefined;
    const region = process.env.R2_REGION || 'us-east-1';
    const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';

    this.bucket = bucket;
    this.hasS3 = !!(bucket && accessKeyId && secretAccessKey);

    this.s3 = new S3Client({
      region,
      endpoint,
      forcePathStyle: !!endpoint,
      credentials: this.hasS3 ? { accessKeyId, secretAccessKey } : undefined,
    });
  }

  /* =======================
     VISITAS POR CÓDIGO
  ======================= */

  async createVisit(
    codeId: bigint,
    visit_date: string,
    visit_type: VisitType,
    notes?: string,
  ) {
    const vd = parseISODateOnly(visit_date);
    const vt = safeVisitType(visit_type);

    if (!vd) throw new BadRequestException('visit_date inválido (YYYY-MM-DD)');
    if (!vt) throw new BadRequestException('visit_type inválido');

    const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
      INSERT INTO code_visits (code_id, visit_date, visit_type, notes)
      VALUES (
        ${codeId},
        ${vd}::date,
        ${vt},
        ${notes ?? null}
      )
      RETURNING id;
    `;

    if (!rows.length) {
      throw new BadRequestException('No se pudo crear la visita');
    }

    return { ok: true, id: Number(rows[0].id) };
  }

  async listVisitsForCode(
    codeId: bigint,
    opts?: { from?: string; to?: string; type?: VisitType },
  ) {
    const from = parseISODateOnly(opts?.from);
    const to = parseISODateOnly(opts?.to);
    const type = safeVisitType(opts?.type);

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, code_id, visit_date, visit_type, notes, created_at
      FROM code_visits
      WHERE code_id = ${codeId}
        AND (${from}::date IS NULL OR visit_date >= ${from}::date)
        AND (${to}::date IS NULL OR visit_date < ${to}::date)
        AND (${type}::text IS NULL OR visit_type = ${type})
      ORDER BY visit_date DESC, id DESC;
    `;

    return {
      ok: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        code_id: Number(r.code_id),
        visit_date: r.visit_date,
        visit_type: r.visit_type,
        notes: r.notes,
        created_at: r.created_at,
      })),
    };
  }

  async deleteVisit(codeId: bigint, visitId: bigint) {
    await this.prisma.$queryRaw`
      DELETE FROM code_visits
      WHERE id = ${visitId} AND code_id = ${codeId};
    `;
    return { ok: true };
  }

  /* =======================
     LISTADO GLOBAL
  ======================= */

  async searchVisits(params: any) {
    const limit = Math.min(5000, Math.max(1, Number(params.limit ?? 500)));
    const vt = safeVisitType(params.visit_type);

    let from = parseISODateOnly(params.from);
    let to = parseISODateOnly(params.to);

    const monthRange = parseMonth(params.month);
    if (monthRange) {
      from = monthRange.from;
      to = monthRange.to;
    }

    const preset = params.preset || '';
    if (!from && !to && preset) {
      const days = preset === '1d' ? 1 :
                   preset === '7d' ? 7 :
                   preset === '15d' ? 15 :
                   preset === '30d' ? 30 : 0;
      if (days) {
        const today = new Date();
        const fromD = new Date(today);
        fromD.setDate(fromD.getDate() - (days - 1));
        from = toDateOnlyString(fromD);
        const toD = new Date(today);
        toD.setDate(toD.getDate() + 1);
        to = toDateOnlyString(toD);
      }
    }

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        v.id AS visit_id,
        v.code_id,
        v.visit_date,
        v.visit_type,
        v.notes,
        v.created_at,
        c.code,
        c.grupo_id,
        c.encargado_actual AS usuario,
        c.baja
      FROM code_visits v
      LEFT JOIN codes c ON c.id = v.code_id
      WHERE
        (${from}::date IS NULL OR v.visit_date >= ${from}::date)
        AND (${to}::date IS NULL OR v.visit_date < ${to}::date)
        AND (${vt}::text IS NULL OR v.visit_type = ${vt})
      ORDER BY v.visit_date DESC, v.id DESC
      LIMIT ${limit};
    `;

    return {
      ok: true,
      items: rows.map((r) => ({
        visit_id: Number(r.visit_id),
        code_id: Number(r.code_id),
        code: r.code,
        visit_date: r.visit_date,
        visit_type: r.visit_type,
        notes: r.notes,
        created_at: r.created_at,
        grupo_id: r.grupo_id,
        usuario: r.usuario,
        baja: r.baja === true,
      })),
    };
  }

  /* =======================
     ARCHIVOS POR VISITA
  ======================= */

  private sanitizeFileName(name: string) {
    return name.replace(/[/\\?%*:|"<>]/g, '-');
  }

  async presignVisitFile(
    codeId: bigint,
    visitId: bigint,
    fileName: string,
    contentType: string,
    size: number,
  ) {
    if (!this.hasS3) {
      throw new BadRequestException('Storage no configurado');
    }

    const cleanName = this.sanitizeFileName(fileName);
    const key = `visits/${codeId}/${visitId}/${Date.now()}_${cleanName}`;

    const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
      INSERT INTO code_visit_files (visit_id, code_id, file_name, content_type, size, storage_key)
      VALUES (${visitId}, ${codeId}, ${cleanName}, ${contentType}, ${BigInt(size)}, ${key})
      RETURNING id;
    `;

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 600 },
    );

    return {
      ok: true,
      fileId: Number(rows[0].id),
      uploadUrl,
    };
  }

  async listVisitFiles(codeId: bigint, visitId: bigint) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, file_name, content_type, size, storage_key, created_at
      FROM code_visit_files
      WHERE code_id = ${codeId} AND visit_id = ${visitId}
      ORDER BY created_at DESC;
    `;

    return {
      ok: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        fileName: r.file_name,
        contentType: r.content_type,
        size: r.size ? Number(r.size) : null,
        storageKey: r.storage_key,
        createdAt: r.created_at,
      })),
    };
  }

  async streamVisitFile(codeId: bigint, visitId: bigint, fileId: bigint) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT file_name, content_type, storage_key
      FROM code_visit_files
      WHERE id = ${fileId} AND code_id = ${codeId} AND visit_id = ${visitId}
      LIMIT 1;
    `;
    if (!rows.length) throw new BadRequestException('Archivo no encontrado');

    const obj = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: rows[0].storage_key,
      }),
    );

    return {
      fileName: rows[0].file_name,
      contentType: rows[0].content_type,
      stream: obj.Body as Readable,
    };
  }

  async deleteVisitFile(codeId: bigint, visitId: bigint, fileId: bigint) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT storage_key
      FROM code_visit_files
      WHERE id = ${fileId} AND code_id = ${codeId} AND visit_id = ${visitId}
      LIMIT 1;
    `;
    if (!rows.length) throw new BadRequestException('Archivo no encontrado');

    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: rows[0].storage_key,
      }),
    );

    await this.prisma.$queryRaw`
      DELETE FROM code_visit_files
      WHERE id = ${fileId};
    `;

    return { ok: true };
  }
}
