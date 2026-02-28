import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

type FileKind = 'general' | 'cal';

function safeKind(kind?: string): FileKind {
  return kind === 'cal' ? 'cal' : 'general';
}

function sanitizeFileName(name: string) {
  const base = (name || '').trim().replace(/[/\\?%*:|"<>]/g, '-');
  return base.length ? base : `archivo-${Date.now()}`;
}

@Injectable()
export class FilesService {
  private s3: S3Client;
  private bucket: string;
  private hasS3: boolean;

  constructor(private readonly prisma: PrismaService) {
    const bucket = process.env.R2_BUCKET || process.env.S3_BUCKET || '';
    const endpoint = process.env.R2_ENDPOINT || process.env.S3_ENDPOINT;
    const region = process.env.R2_REGION || process.env.S3_REGION || 'us-east-1';

    const accessKeyId =
      process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || '';
    const secretAccessKey =
      process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || '';

    this.bucket = bucket;
    this.hasS3 = !!(bucket && accessKeyId && secretAccessKey);

    this.s3 = new S3Client({
      region,
      endpoint,
      forcePathStyle: !!endpoint,
      credentials: this.hasS3 ? { accessKeyId, secretAccessKey } : undefined,
    });
  }

  async presign(
    codeId: bigint,
    fileName: string,
    contentType: string,
    size: number,
    kind: FileKind,
  ) {
    if (!codeId) throw new BadRequestException('codeId inválido');
    if (!fileName) throw new BadRequestException('fileName requerido');
    if (!size || size <= 0) throw new BadRequestException('size inválido');

    if (!this.hasS3) {
      throw new BadRequestException(
        'Storage no configurado. Revisa R2_BUCKET/R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY.',
      );
    }

    const k = safeKind(kind);
    const cleanName = sanitizeFileName(fileName);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const storageKey = `codes/${codeId}/${k}/${ts}__${cleanName}`;

    const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
      INSERT INTO code_files (code_id, kind, file_name, content_type, size, storage_key)
      VALUES (${codeId}, ${k}, ${cleanName}, ${contentType}, ${BigInt(size)}, ${storageKey})
      RETURNING id;
    `;

    if (!rows.length) throw new BadRequestException('No se pudo registrar el archivo');
    const fileId = Number(rows[0].id);

    const putCmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: contentType || 'application/octet-stream',
    });

    const uploadUrl = await getSignedUrl(this.s3, putCmd, { expiresIn: 60 * 10 });

    return {
      ok: true,
      fileId,
      kind: k,
      fileName: cleanName,
      contentType,
      size,
      storageKey,
      uploadUrl,
    };
  }

  async list(codeId: bigint, kind: FileKind) {
    const k = safeKind(kind);

    const rows = await this.prisma.$queryRaw<
      {
        id: bigint;
        code_id: bigint;
        kind: string;
        file_name: string;
        content_type: string | null;
        size: bigint | null;
        storage_key: string;
        created_at: Date;
      }[]
    >`
      SELECT id, code_id, kind, file_name, content_type, size, storage_key, created_at
      FROM code_files
      WHERE code_id = ${codeId} AND kind = ${k}
      ORDER BY created_at DESC;
    `;

    return {
      ok: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        code_id: Number(r.code_id),
        kind: r.kind,
        fileName: r.file_name,
        contentType: r.content_type,
        size: r.size ? Number(r.size) : null,
        storageKey: r.storage_key,
        createdAt: r.created_at,
        downloadUrl: null, // ya no usamos R2 directo en frontend
      })),
    };
  }

  async streamFile(
    codeId: bigint,
    fileId: bigint,
  ): Promise<{ stream: Readable; contentType: string | null; fileName: string }> {
    if (!this.hasS3) {
      throw new BadRequestException(
        'Storage no configurado (faltan variables R2_* en Railway).',
      );
    }

    const rows = await this.prisma.$queryRaw<
      { storage_key: string; file_name: string; content_type: string | null }[]
    >`
      SELECT storage_key, file_name, content_type
      FROM code_files
      WHERE id = ${fileId} AND code_id = ${codeId}
      LIMIT 1;
    `;

    if (!rows.length) throw new BadRequestException('Archivo no encontrado');

    const { storage_key, file_name, content_type } = rows[0];

    const out = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: storage_key,
      }),
    );

    if (!out.Body) throw new BadRequestException('No se pudo leer el archivo (Body vacío)');

    // ✅ Compatibilidad total (Node 18/20, sdk v3)
    const bodyAny: any = out.Body;
    const stream: Readable =
      bodyAny instanceof Readable ? bodyAny : Readable.from(bodyAny);

    return {
      stream,
      contentType: content_type,
      fileName: file_name,
    };
  }

  async remove(codeId: bigint, fileId: bigint) {
    const rows = await this.prisma.$queryRaw<{ storage_key: string }[]>`
      SELECT storage_key
      FROM code_files
      WHERE id = ${fileId} AND code_id = ${codeId}
      LIMIT 1;
    `;

    if (!rows.length) throw new BadRequestException('Archivo no encontrado');
    const storageKey = rows[0].storage_key;

    if (this.hasS3) {
      try {
        await this.s3.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: storageKey,
          }),
        );
      } catch {
        // si falla delete, igual borramos metadata
      }
    }

    await this.prisma.$queryRaw`
      DELETE FROM code_files
      WHERE id = ${fileId} AND code_id = ${codeId};
    `;

    return { ok: true };
  }
}
