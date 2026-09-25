import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  categoryKeys,
  delegationCreateSchema,
  delegationRevokeSchema,
  regionToPolygonGeoJson,
  MODERATION_PERMISSIONS
} from "@map/shared/contracts";
import { query, transaction } from "../db";
import { AppError, conflict, forbidden, notFound } from "../errors";
import { requireAdmin, requireModerator } from "../auth";
import { recordAudit } from "../audit";
import { loadActiveScopes, serializeDelegation, type DelegationRow } from "../delegation";

const DELEGATION_MAX_DAYS = 30;
const DELEGATION_MIN_MS = 5 * 60 * 1000;

export async function delegationRoutes(app: FastifyInstance) {
  // 可被授予临时范围的审核员列表（仅管理员）。
  app.get("/admin/moderators", { preHandler: requireAdmin }, async () => {
    const result = await query(
      `SELECT id, email, display_name, status
       FROM users
       WHERE role = 'moderator' AND deleted_at IS NULL
       ORDER BY display_name, email`
    );
    return result.rows;
  });

  // 当前审核员自己的有效临时范围（页面据此决定显示哪些审核按钮）。
  app.get("/moderation/my-scope", { preHandler: requireModerator }, async (request) => {
    const result = await query<DelegationRow>(
      `SELECT id, grantee_id, granted_by, permissions, category_keys, region_geojson,
              reason, valid_until, revoked_at, revoked_by, revoke_reason, created_at
       FROM moderation_delegations
       WHERE grantee_id = $1 AND revoked_at IS NULL AND valid_until > now()
       ORDER BY valid_until ASC`,
      [request.user!.id]
    );
    return {
      scopes: result.rows.map((row) => serializeDelegation(row)),
      allPermissions: MODERATION_PERMISSIONS,
      allCategories: categoryKeys
    };
  });

  // 管理员查看自己发起的委托（可按被授予者与状态过滤）。
  app.get("/admin/delegations", { preHandler: requireAdmin }, async (request) => {
    const input = z
      .object({
        granteeId: z.string().uuid().optional(),
        status: z.enum(["active", "revoked", "expired", "all"]).default("all")
      })
      .parse(request.query);

    const values: unknown[] = [request.user!.id];
    const conditions = ["d.granted_by = $1"];
    if (input.granteeId) {
      values.push(input.granteeId);
      conditions.push(`d.grantee_id = $${values.length}`);
    }
    if (input.status === "active") conditions.push("d.revoked_at IS NULL AND d.valid_until > now()");
    if (input.status === "revoked") conditions.push("d.revoked_at IS NOT NULL");
    if (input.status === "expired") conditions.push("d.revoked_at IS NULL AND d.valid_until <= now()");

    const result = await query<
      DelegationRow & { grantee_name: string; grantee_email: string; granted_by_name: string }
    >(
      `SELECT d.*, gu.display_name AS grantee_name, gu.email AS grantee_email,
              bu.display_name AS granted_by_name
       FROM moderation_delegations d
       JOIN users gu ON gu.id = d.grantee_id
       JOIN users bu ON bu.id = d.granted_by
       WHERE ${conditions.join(" AND ")}
       ORDER BY d.created_at DESC
       LIMIT 200`,
      values
    );
    return {
      delegations: result.rows.map((row) => ({
        ...serializeDelegation(row),
        granteeName: row.grantee_name,
        granteeEmail: row.grantee_email,
        grantedByName: row.granted_by_name
      }))
    };
  });

  // 授予临时审核范围：按分类、地区、动作集合和有效期。
  app.post("/admin/delegations", { preHandler: requireAdmin }, async (request, reply) => {
    const input = delegationCreateSchema.parse(request.body);

    // 白名单已经过 Zod 校验，这里只做去重（防御性）。
    const permissions = Array.from(new Set(input.permissions));
    const categoryKeysList = Array.from(new Set(input.categoryKeys));

    const validUntil = new Date(input.validUntil);
    const now = Date.now();
    const untilMs = validUntil.getTime();
    if (!Number.isFinite(untilMs) || untilMs - now < DELEGATION_MIN_MS) {
      throw new AppError(400, "VALIDATION_FAILED", "有效期至少为 5 分钟");
    }
    if (untilMs - now > DELEGATION_MAX_DAYS * 24 * 60 * 60 * 1000) {
      throw new AppError(400, "VALIDATION_FAILED", `临时范围最长 ${DELEGATION_MAX_DAYS} 天`);
    }

    if (input.granteeId === request.user!.id) throw forbidden("不能把审核范围委托给自己");

    const regionGeoJson = input.region ? regionToPolygonGeoJson(input.region) : null;

    const created = await transaction(async (client) => {
      const grantee = await client.query<{ id: string; role: string; display_name: string }>(
        "SELECT id, role, display_name FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
        [input.granteeId]
      );
      const granteeRow = grantee.rows[0];
      if (!granteeRow) throw notFound("被授予用户不存在");
      if (granteeRow.role !== "moderator") {
        throw new AppError(400, "VALIDATION_FAILED", "临时审核范围只能授予审核员");
      }

      if (categoryKeysList.length) {
        const existing = await client.query(
          "SELECT key FROM categories WHERE key = ANY($1::text[]) AND is_active = true",
          [categoryKeysList]
        );
        if (existing.rowCount !== categoryKeysList.length) {
          throw new AppError(400, "VALIDATION_FAILED", "包含未知或已停用的分类");
        }
      }

      const inserted = await client.query<DelegationRow>(
        `INSERT INTO moderation_delegations(
           grantee_id, granted_by, permissions, category_keys, region_geojson, region, reason, valid_until
         )
         VALUES (
           $1, $2, $3::moderation_permission[], $4::text[], $5::jsonb,
           CASE WHEN $5::jsonb IS NULL THEN NULL ELSE ST_GeomFromGeoJSON($5::jsonb) END,
           $6, $7
         )
         RETURNING id, grantee_id, granted_by, permissions, category_keys, region_geojson,
                   reason, valid_until, revoked_at, revoked_by, revoke_reason, created_at`,
        [
          input.granteeId,
          request.user!.id,
          permissions,
          categoryKeysList.length ? categoryKeysList : null,
          regionGeoJson ? JSON.stringify(regionGeoJson) : null,
          input.reason,
          validUntil
        ]
      );
      const row = inserted.rows[0]!;

      await recordAudit(client, {
        actorId: request.user!.id,
        action: "delegation.granted",
        resourceType: "moderation_delegation",
        resourceId: row.id,
        metadata: {
          granteeId: input.granteeId,
          permissions,
          categoryKeys: categoryKeysList,
          region: input.region,
          reason: input.reason,
          validUntil: validUntil.toISOString()
        }
      });
      return row;
    });

    return reply.code(201).send(serializeDelegation(created));
  });

  // 提前撤销委托。
  app.delete("/admin/delegations/:id", { preHandler: requireAdmin }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = delegationRevokeSchema.parse(request.body ?? {});

    await transaction(async (client) => {
      const result = await client.query<{ id: string; granted_by: string; revoked_at: Date | null; valid_until: Date }>(
        `SELECT id, granted_by, revoked_at, valid_until
         FROM moderation_delegations
         WHERE id = $1
         FOR UPDATE`,
        [params.id]
      );
      const row = result.rows[0];
      if (!row) throw notFound("委托不存在");
      if (row.granted_by !== request.user!.id) throw forbidden("只能撤销自己授予的临时范围");
      if (row.revoked_at) throw conflict("该委托已经撤销");
      if (row.valid_until.getTime() <= Date.now()) throw conflict("该委托已经过期");

      await client.query(
        "UPDATE moderation_delegations SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1",
        [params.id, request.user!.id, input.reason]
      );
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "delegation.revoked",
        resourceType: "moderation_delegation",
        resourceId: params.id,
        metadata: { reason: input.reason }
      });
    });
    return { status: "revoked" };
  });
}
