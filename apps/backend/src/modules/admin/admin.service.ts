import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

type StringOrNull = string | null;
type CommentRow = {
  id: bigint;
  code_id: bigint;
  code: string | null;
  comentario: string;
  created_at: Date;
  actor_username?: string | null;
  actor_role?: string | null;
};

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(private prisma: PrismaService) {}

  private currentMonthRange() {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { from: fmt(from), to: fmt(to) };
  }

  async dashboard() {
    const { from, to } = this.currentMonthRange();

    const [codesAgg] = await this.prisma.$queryRaw<
      { total: bigint; m13count: bigint }[]
    >`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE m13 = true)::bigint AS m13count
      FROM codes;
    `;

    const byGroup = await this.prisma.$queryRaw<
      { grupo_id: bigint | null; group_name: StringOrNull; count: bigint }[]
    >`
      SELECT c.grupo_id, g.name AS group_name, COUNT(*)::bigint AS count
      FROM codes c
      LEFT JOIN groups g ON g.id = c.grupo_id
      GROUP BY c.grupo_id, g.name
      ORDER BY count DESC;
    `;

    const [monthVisits] = await this.prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*)::bigint AS cnt
      FROM code_visits v
      WHERE v.visit_date >= ${from}::date AND v.visit_date < ${to}::date;
    `;

    const visitsByType = await this.prisma.$queryRaw<
      { visit_type: string; count: bigint }[]
    >`
      SELECT v.visit_type, COUNT(*)::bigint AS count
      FROM code_visits v
      WHERE v.visit_date >= ${from}::date AND v.visit_date < ${to}::date
      GROUP BY v.visit_type
      ORDER BY count DESC;
    `;

    const lastVisits = await this.prisma.$queryRaw<
      {
        visit_id: bigint;
        code_id: bigint;
        code: string | null;
        visit_date: Date;
        visit_type: string;
        usuario: string | null;
        grupo_id: number | null;
      }[]
    >`
      SELECT
        v.id AS visit_id,
        v.code_id,
        c.code,
        v.visit_date,
        v.visit_type,
        c.encargado_actual AS usuario,
        c.grupo_id
      FROM code_visits v
      LEFT JOIN codes c ON c.id = v.code_id
      ORDER BY v.visit_date DESC, v.id DESC
      LIMIT 10;
    `;

    let commentsRows: CommentRow[];
    try {
      commentsRows = await this.prisma.$queryRaw<
        CommentRow[]
      >`
        SELECT
          cm.id,
          cm.code_id,
          c.code,
          cm.comentario,
          cm.created_at,
          cm.actor_username,
          cm.actor_role
        FROM code_comments cm
        LEFT JOIN codes c ON c.id = cm.code_id
        ORDER BY cm.created_at DESC
        LIMIT 10;
      `;
    } catch (err) {
      this.logger.error('Falling back to comments query without actor fields', err as any);
      commentsRows = await this.prisma.$queryRaw<
        CommentRow[]
      >`
        SELECT
          cm.id,
          cm.code_id,
          c.code,
          cm.comentario,
          cm.created_at
        FROM code_comments cm
        LEFT JOIN codes c ON c.id = cm.code_id
        ORDER BY cm.created_at DESC
        LIMIT 10;
      `;
    }

    return {
      ok: true,
      codes: {
        total: Number(codesAgg?.total ?? 0),
        m13Count: Number(codesAgg?.m13count ?? 0),
        byGroup: byGroup.map((r) => ({
          grupo_id: r.grupo_id === null ? null : Number(r.grupo_id),
          group_name: r.group_name ?? undefined,
          count: Number(r.count),
        })),
      },
      visits: {
        monthCount: Number(monthVisits?.cnt ?? 0),
        last10: lastVisits.map((r) => ({
          visit_id: Number(r.visit_id),
          code_id: Number(r.code_id),
          code: r.code,
          visit_date: r.visit_date,
          visit_type: r.visit_type,
          usuario: r.usuario ?? undefined,
          grupo_id: r.grupo_id ?? undefined,
        })),
        byType: visitsByType.map((r) => ({
          visit_type: r.visit_type,
          count: Number(r.count),
        })),
      },
      comments: {
        last10: commentsRows.map((r) => ({
          id: Number(r.id),
          code_id: Number(r.code_id),
          code: r.code,
          comentario: r.comentario,
          created_at: r.created_at,
          actor_username: r.actor_username ?? undefined,
          actor_role: r.actor_role ?? undefined,
        })),
      },
    };
  }
}
