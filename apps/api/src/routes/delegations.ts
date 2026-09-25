import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { delegationCreateSchema, delegationRevokeSchema } from "@map/shared/contracts";
import { normalizeEmail } from "@map/shared/server";
import { query, transaction } from "../db";
import { conflict, notFound } from "../errors";
import { requireAdmin, requireModerator } from "../auth";
import { recordAudit } from "../audit";
import { notifyUser } from "../notifications";
import { loadActiveDelegations } from "../delegation";

// 委托、撤销、越权拒绝与高风险审核操作在同一张审计表中共同检索。
export const GOVERNANCE_AUDIT_ACTIONS = [
  "delegation.granted",
  "delegation.revoked",
  "moderation.scope_denied",
  "feature.hidden",
  "feature.restored",
  "comment.hidden",
  "media.privacy_approved",
  "report.resolved"
] as const;

function scopeSummary(input: {
  categoryKeys: string[];
  regionName?: string | null | undefined;
  allowHighRisk: boolean;
  expiresAt: Date;
}): string {
  const categories = input.categoryKeys.length ? input.categoryKeys.join("、") : "全部分类";
  const region = input.regionName ?? "不限地区";
  const risk = input.allowHighRisk ? "，含高风险操作" : "";
  return `范围：${categories} / ${region}${risk}，有效期至 ${input.expiresAt.toISOString()}`;
}

export async function delegationRoutes(app: FastifyInstance) {
  app.get("/moderation/scope", { preHandler: requireModerator }, async (request) => {
    const user = request.user!;
    if (user.role === "admin") {
      return { role: user.role, unrestricted: true, canApproveMedia: true, delegations: [] };
    }
    const delegations = await loadActiveDelegations(user.id);
    return {
      role: user.role,
      unrestricted: false,
      canApproveMedia: delegations.some((scope) => scope.allowHighRisk),
      delegations: delegations.map((scope) => ({
        id: scope.id,
        categoryKeys: scope.categoryKeys,
        region: scope.region,
        regionName: scope.regionName,
        allowHighRisk: scope.allowHighRisk,
        expiresAt: scope.expiresAt
      }))
    };
  });

  app.get("/admin/delegations", { preHandler: requireAdmin }, async (request) => {
    const input = z.object({
      status: z.enum(["active", "revoked", "expired", "all"]).default("all")
    }).parse(request.query);
    const filters: string[] = [];
    if (input.status === "active") filters.push("d.status = 'active' AND d.expires_at > now()");
    if (input.status === "revoked") filters.push("d.status = 'revoked'");
    if (input.status === "expired") filters.push("d.status = 'active' AND d.expires_at <= now()");
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await query(
      `SELECT d.id, d.category_keys, d.region, d.region_name, d.allow_high_risk, d.note,
              d.status, d.expires_at, d.revoked_at, d.revoke_reason, d.created_at,
              d.delegate_id, du.display_name AS delegate_name, du.email AS delegate_email,
              d.grantor_id, gu.display_name AS grantor_name,
              ru.display_name AS revoked_by_name
       FROM moderation_delegations d
       JOIN users du ON du.id = d.delegate_id
       JOIN users gu ON gu.id = d.grantor_id
       LEFT JOIN users ru ON ru.id = d.revoked_by
       ${where}
       ORDER BY d.created_at DESC
       LIMIT 200`
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      ...row,
      effective_status: row.status === "revoked"
        ? "revoked"
        : new Date(row.expires_at as string) <= new Date()
          ? "expired"
          : "active"
    }));
  });

  app.post("/admin/delegations", { preHandler: requireAdmin }, async (request, reply) => {
    const input = delegationCreateSchema.parse(request.body);
    const delegateResult = await query<{
      id: string;
      role: string;
      status: string;
      display_name: string;
    }>(
      `SELECT id, role, status, display_name FROM users
       WHERE email_normalized = $1 AND deleted_at IS NULL`,
      [normalizeEmail(input.delegateEmail)]
    );
    const delegate = delegateResult.rows[0];
    if (!delegate) throw notFound("Delegate account not found");
    if (delegate.role !== "moderator") {
      throw conflict("Delegations can only be granted to moderator accounts");
    }
    if (delegate.status !== "active") {
      throw conflict("Delegate account must be active");
    }

    const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);
    const id = await transaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO moderation_delegations(
           delegate_id, grantor_id, category_keys, region, region_name,
           allow_high_risk, note, expires_at
         )
         VALUES ($1, $2, $3::text[], $4::jsonb, $5, $6, $7, $8)
         RETURNING id`,
        [
          delegate.id,
          request.user!.id,
          input.categoryKeys,
          input.region ? JSON.stringify(input.region) : null,
          input.regionName ?? null,
          input.allowHighRisk,
          input.note ?? null,
          expiresAt
        ]
      );
      const delegationId = inserted.rows[0]!.id;
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "delegation.granted",
        resourceType: "delegation",
        resourceId: delegationId,
        metadata: {
          delegateId: delegate.id,
          delegateEmail: input.delegateEmail,
          categoryKeys: input.categoryKeys,
          region: input.region ?? null,
          regionName: input.regionName ?? null,
          allowHighRisk: input.allowHighRisk,
          expiresAt: expiresAt.toISOString(),
          note: input.note ?? null
        }
      });
      await notifyUser(client, {
        userId: delegate.id,
        type: "delegation_granted",
        title: "你已获得临时审核权限",
        body: scopeSummary({ ...input, expiresAt }),
        link: "/moderation"
      });
      return delegationId;
    });

    return reply.code(201).send({ id, status: "active", expiresAt });
  });

  app.post("/admin/delegations/:id/revoke", { preHandler: requireAdmin }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = delegationRevokeSchema.parse(request.body);
    await transaction(async (client) => {
      const result = await client.query<{ delegate_id: string; expires_at: Date }>(
        `UPDATE moderation_delegations
         SET status = 'revoked', revoked_at = now(), revoked_by = $2,
             revoke_reason = $3, updated_at = now()
         WHERE id = $1 AND status = 'active'
         RETURNING delegate_id, expires_at`,
        [params.id, request.user!.id, input.reason]
      );
      const delegation = result.rows[0];
      if (!delegation) throw notFound("Active delegation not found");
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "delegation.revoked",
        resourceType: "delegation",
        resourceId: params.id,
        metadata: {
          delegateId: delegation.delegate_id,
          reason: input.reason,
          wasExpired: delegation.expires_at <= new Date()
        }
      });
      await notifyUser(client, {
        userId: delegation.delegate_id,
        type: "delegation_revoked",
        title: "你的临时审核权限已被撤销",
        body: `撤销原因：${input.reason}`,
        link: "/me/notifications"
      });
    });
    return { status: "revoked" };
  });

  app.get("/admin/delegations/audit", { preHandler: requireAdmin }, async (request) => {
    const input = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(100)
    }).parse(request.query);
    const result = await query(
      `SELECT al.id, al.actor_id, u.display_name AS actor_name, al.action,
              al.resource_type, al.resource_id, al.metadata, al.created_at
       FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id
       WHERE al.action = ANY($1::text[])
       ORDER BY al.created_at DESC LIMIT $2`,
      [GOVERNANCE_AUDIT_ACTIONS, input.limit]
    );
    return result.rows;
  });
}
