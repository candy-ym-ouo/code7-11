import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { moderationDecisionSchema } from "@map/shared/contracts";
import { query, transaction } from "../db";
import { conflict, forbidden, notFound } from "../errors";
import { requireAdmin, requireModerator } from "../auth";
import { recordAudit } from "../audit";
import { notifyUser } from "../notifications";
import {
  assertScopedPermission,
  resolveScopedActor,
  scopeExistenceClause,
  type PermissionCheck
} from "../delegation";

type ScopeTargetRow = {
  category_key: string | null;
  longitude: number | null;
  latitude: number | null;
};

function scopeMeta(check: PermissionCheck): Record<string, unknown> {
  return {
    highRisk: check.highRisk,
    ...(check.delegationId ? { delegationId: check.delegationId } : {})
  };
}

// 待审修订的点来自待审 payload（批准后内容才真正落在该坐标）。
const REVISION_POINT =
  "ST_SetSRID(ST_MakePoint((fr.payload->>'longitude')::numeric, (fr.payload->>'latitude')::numeric), 4326)";
const REVISION_CATEGORY = "fr.payload->>'categoryKey'";

export async function moderationRoutes(app: FastifyInstance) {
  app.get("/moderation/queue", { preHandler: requireModerator }, async (request) => {
    const isAdmin = request.user!.role === "admin";
    const actorId = request.user!.id;

    const [features, comments, media, reports] = await Promise.all([
      query(
        `SELECT fr.id AS revision_id, fr.feature_id, fr.revision_no, fr.payload, fr.submitted_at,
                fr.payload->>'categoryKey' AS category_key,
                (fr.payload->>'longitude')::float8 AS longitude,
                (fr.payload->>'latitude')::float8 AS latitude,
                mf.status AS feature_status, u.display_name AS author_name
         FROM feature_revisions fr
         JOIN map_features mf ON mf.id = fr.feature_id
         JOIN users u ON u.id = fr.author_id
         WHERE fr.status = 'pending' AND mf.deleted_at IS NULL
         ${
           isAdmin
             ? ""
             : `AND ${scopeExistenceClause("$1", "$2", REVISION_CATEGORY, REVISION_POINT)}`
         }
         ORDER BY fr.submitted_at ASC
         LIMIT 100`,
        isAdmin ? [] : [actorId, "feature.approve"]
      ),
      query(
        `SELECT c.id, c.feature_id, c.body, c.status, c.created_at, u.display_name AS author_name,
                mf.category_key, ST_X(mf.geom::geometry) AS longitude, ST_Y(mf.geom::geometry) AS latitude
         FROM comments c
         JOIN users u ON u.id = c.author_id
         JOIN map_features mf ON mf.id = c.feature_id
         WHERE c.status = 'pending' AND c.deleted_at IS NULL
         ${
           isAdmin
             ? ""
             : `AND ${scopeExistenceClause("$1", "$2", "mf.category_key", "mf.geom::geometry")}`
         }
         ORDER BY c.created_at ASC LIMIT 100`,
        isAdmin ? [] : [actorId, "comment.approve"]
      ),
      // 媒体：挂到待审修订的跟随待审 payload；否则取最新关联修订对应地点；
      // 完全没有关联内容的孤立媒体，只对“全分类、无地区限制”的审核员可见。
      query(
        `SELECT ma.id, ma.original_filename, ma.privacy_status, ma.privacy_report,
                ma.processed_object_key, ma.created_at, u.display_name AS owner_name,
                st.category_key, st.longitude, st.latitude
         FROM media_assets ma
         JOIN users u ON u.id = ma.owner_id
         CROSS JOIN LATERAL (
           SELECT
             COALESCE(frp.payload->>'categoryKey', mf2.category_key) AS category_key,
             COALESCE((frp.payload->>'longitude')::float8, ST_X(mf2.geom::geometry)) AS longitude,
             COALESCE((frp.payload->>'latitude')::float8, ST_Y(mf2.geom::geometry)) AS latitude,
             (frp.feature_id IS NULL AND mf2.id IS NULL) AS orphan
           FROM (
             SELECT
               (
                 SELECT fr_pending.feature_id
                 FROM revision_media rm_p
                 JOIN feature_revisions fr_pending ON fr_pending.id = rm_p.revision_id
                 WHERE rm_p.media_id = ma.id AND fr_pending.status = 'pending'
                 ORDER BY fr_pending.submitted_at DESC
                 LIMIT 1
               ) AS pending_feature_id,
               (
                 SELECT mf_latest.id
                 FROM revision_media rm_l
                 JOIN feature_revisions fr_latest ON fr_latest.id = rm_l.revision_id
                 JOIN map_features mf_latest ON mf_latest.id = fr_latest.feature_id
                 WHERE rm_l.media_id = ma.id AND mf_latest.deleted_at IS NULL
                 ORDER BY fr_latest.created_at DESC
                 LIMIT 1
               ) AS latest_feature_id
           ) picked
           LEFT JOIN LATERAL (
             SELECT payload FROM feature_revisions
             WHERE feature_id = picked.pending_feature_id AND status = 'pending'
             ORDER BY revision_no DESC
             LIMIT 1
           ) frp ON true
           LEFT JOIN map_features mf2
             ON mf2.id = COALESCE(picked.pending_feature_id, picked.latest_feature_id)
         ) st
         WHERE ma.privacy_status = 'manual_review' AND ma.deleted_at IS NULL
         ${
           isAdmin
             ? ""
             : `AND (
               ${scopeExistenceClause(
                 "$1",
                 "$2",
                 "st.category_key",
                 "ST_SetSRID(ST_MakePoint(st.longitude, st.latitude), 4326)",
                 "mdm"
               )}
               OR (
                 st.orphan
                 AND EXISTS (
                   SELECT 1 FROM moderation_delegations md0
                   WHERE md0.grantee_id = $1 AND md0.revoked_at IS NULL AND md0.valid_until > now()
                     AND 'media.privacy_approve'::moderation_permission = ANY(md0.permissions)
                     AND md0.category_keys IS NULL
                     AND md0.region IS NULL
                 )
               )
             )`
         }
         ORDER BY ma.created_at ASC LIMIT 100`,
        isAdmin ? [] : [actorId, "media.privacy_approve"]
      ),
      query(
        `SELECT r.id, r.target_type, r.target_id, r.reason_code, r.notes, r.created_at,
                u.display_name AS reporter_name,
                scope_target.category_key, scope_target.longitude, scope_target.latitude
         FROM reports r
         JOIN users u ON u.id = r.reporter_id
         CROSS JOIN LATERAL (
           SELECT mf.category_key, ST_X(mf.geom::geometry) AS longitude, ST_Y(mf.geom::geometry) AS latitude
           FROM map_features mf
           WHERE r.target_type = 'feature' AND mf.id = r.target_id AND mf.deleted_at IS NULL
           UNION ALL
           SELECT mf.category_key, ST_X(mf.geom::geometry), ST_Y(mf.geom::geometry)
           FROM comments c
           JOIN map_features mf ON mf.id = c.feature_id
           WHERE r.target_type = 'comment' AND c.id = r.target_id AND c.deleted_at IS NULL AND mf.deleted_at IS NULL
         ) scope_target ON true
         WHERE r.status = 'open'
         ${
           isAdmin
             ? ""
             : `AND ${scopeExistenceClause(
                 "$1",
                 "$2",
                 "scope_target.category_key",
                 "ST_SetSRID(ST_MakePoint(scope_target.longitude, scope_target.latitude), 4326)",
                 "mdr"
               )}`
         }
         ORDER BY r.created_at ASC LIMIT 100`,
        isAdmin ? [] : [actorId, "report.resolve"]
      )
    ]);

    return {
      counts: {
        features: features.rowCount,
        comments: comments.rowCount,
        media: media.rowCount,
        reports: reports.rowCount
      },
      features: features.rows,
      comments: comments.rows,
      media: media.rows,
      reports: reports.rows
    };
  });

  app.post("/moderation/features/:id/approve", { preHandler: requireModerator }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await transaction(async (client) => {
      const actor = await resolveScopedActor(client, request.user!);
      const revisionResult = await client.query<{
        id: string;
        payload: { categoryKey: string; longitude: number; latitude: number; locationAccuracyM: number; mediaIds?: string[] };
        author_id: string;
      }>(
        `SELECT fr.id, fr.payload, fr.author_id
         FROM feature_revisions fr
         JOIN map_features mf ON mf.id = fr.feature_id
         WHERE fr.feature_id = $1 AND fr.status = 'pending' AND mf.deleted_at IS NULL
         ORDER BY fr.revision_no DESC LIMIT 1 FOR UPDATE`,
        [params.id]
      );
      const revision = revisionResult.rows[0];
      if (!revision) throw notFound("Pending revision not found");

      const check = assertScopedPermission(actor, "feature.approve", {
        categoryKey: revision.payload.categoryKey,
        longitude: revision.payload.longitude,
        latitude: revision.payload.latitude
      });

      const mediaIds = revision.payload.mediaIds ?? [];
      if (mediaIds.length) {
        const media = await client.query<{ id: string; privacy_status: string }>(
          "SELECT id, privacy_status FROM media_assets WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL",
          [mediaIds]
        );
        if (media.rowCount !== mediaIds.length || media.rows.some((row) => row.privacy_status !== "ready")) {
          throw conflict("All attached media must pass privacy review before content approval");
        }
      }

      await client.query(
        `UPDATE feature_revisions
         SET status = 'published', reviewed_at = now(), reviewer_id = $2,
             rejection_reason_code = NULL, updated_at = now()
         WHERE id = $1`,
        [revision.id, request.user!.id]
      );
      await client.query(
        `UPDATE map_features
         SET current_revision_id = $2,
             status = 'published',
             category_key = $3,
             geom = ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
             location_accuracy_m = $6,
             first_published_at = COALESCE(first_published_at, now()),
             freshness_expires_at = now() + interval '180 days',
             needs_review_at = NULL,
             updated_at = now()
         WHERE id = $1`,
        [
          params.id,
          revision.id,
          revision.payload.categoryKey,
          revision.payload.longitude,
          revision.payload.latitude,
          revision.payload.locationAccuracyM
        ]
      );
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "feature.approved",
        resourceType: "feature",
        resourceId: params.id,
        metadata: { revisionId: revision.id, ...scopeMeta(check) }
      });
      await notifyUser(client, {
        userId: revision.author_id,
        type: "feature_approved",
        title: "你的地点细节已通过审核",
        body: "内容已发布到公共地图。",
        link: `/features/${params.id}`
      });
    });
    return { status: "published" };
  });

  app.post("/moderation/features/:id/reject", { preHandler: requireModerator }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = moderationDecisionSchema.parse(request.body);
    await transaction(async (client) => {
      const actor = await resolveScopedActor(client, request.user!);
      const revision = await activePendingRevision(client, params.id);
      const check = assertScopedPermission(actor, "feature.reject", {
        categoryKey: revision.payload.categoryKey,
        longitude: revision.payload.longitude,
        latitude: revision.payload.latitude
      });
      await client.query(
        `UPDATE feature_revisions
         SET status = 'rejected', reviewed_at = now(), reviewer_id = $2,
             rejection_reason_code = $3, moderation_notes = $4, updated_at = now()
         WHERE id = $1`,
        [revision.id, request.user!.id, input.reasonCode, input.notes ?? null]
      );
      await client.query(
        `UPDATE map_features
         SET status = CASE WHEN current_revision_id IS NULL THEN 'rejected'::content_status ELSE status END,
             updated_at = now()
         WHERE id = $1`,
        [params.id]
      );
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "feature.rejected",
        resourceType: "feature",
        resourceId: params.id,
        metadata: {
          revisionId: revision.id,
          reasonCode: input.reasonCode,
          notes: input.notes,
          ...scopeMeta(check)
        }
      });
      await notifyUser(client, {
        userId: revision.author_id,
        type: "feature_rejected",
        title: "你的地点细节未通过审核",
        body: `拒绝原因：${input.reasonCode}${input.notes ? `。${input.notes}` : ""}`,
        link: "/me/contributions"
      });
    });
    return { status: "rejected" };
  });

  app.post("/moderation/features/:id/request-changes", { preHandler: requireModerator }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = moderationDecisionSchema.parse(request.body);
    await transaction(async (client) => {
      const actor = await resolveScopedActor(client, request.user!);
      const revision = await activePendingRevision(client, params.id);
      const check = assertScopedPermission(actor, "feature.request_changes", {
        categoryKey: revision.payload.categoryKey,
        longitude: revision.payload.longitude,
        latitude: revision.payload.latitude
      });
      await client.query(
        `UPDATE feature_revisions
         SET status = 'changes_requested', reviewed_at = now(), reviewer_id = $2,
             rejection_reason_code = $3, moderation_notes = $4, updated_at = now()
         WHERE id = $1`,
        [revision.id, request.user!.id, input.reasonCode, input.notes ?? null]
      );
      await client.query(
        `UPDATE map_features
         SET status = CASE WHEN current_revision_id IS NULL THEN 'changes_requested'::content_status ELSE status END,
             updated_at = now()
         WHERE id = $1`,
        [params.id]
      );
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "feature.changes_requested",
        resourceType: "feature",
        resourceId: params.id,
        metadata: {
          revisionId: revision.id,
          reasonCode: input.reasonCode,
          ...scopeMeta(check)
        }
      });
      await notifyUser(client, {
        userId: revision.author_id,
        type: "feature_changes_requested",
        title: "你的地点细节需要修改",
        body: `${input.reasonCode}${input.notes ? `：${input.notes}` : ""}`,
        link: "/me/contributions"
      });
    });
    return { status: "changes_requested" };
  });

  app.post("/moderation/features/:id/hide", { preHandler: requireModerator }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = moderationDecisionSchema.parse(request.body);
    await transaction(async (client) => {
      const actor = await resolveScopedActor(client, request.user!);
      const result = await client.query<{ owner_id: string } & ScopeTargetRow>(
        `SELECT owner_id, category_key,
                ST_X(geom::geometry) AS longitude, ST_Y(geom::geometry) AS latitude
         FROM map_features
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [params.id]
      );
      const feature = result.rows[0];
      if (!feature) throw notFound("Feature not found");
      const check = assertScopedPermission(actor, "feature.hide", feature);
      await client.query(
        "UPDATE map_features SET status = 'hidden', updated_at = now() WHERE id = $1",
        [params.id]
      );
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "feature.hidden",
        resourceType: "feature",
        resourceId: params.id,
        metadata: { reasonCode: input.reasonCode, notes: input.notes, ...scopeMeta(check) }
      });
      await notifyUser(client, {
        userId: feature.owner_id,
        type: "feature_hidden",
        title: "你的地点细节已被隐藏",
        body: `${input.reasonCode}${input.notes ? `：${input.notes}` : ""}`,
        link: "/me/contributions"
      });
    });
    return { status: "hidden" };
  });

  // 恢复是仅管理员动作，不允许通过临时委托获得。
  app.post("/moderation/features/:id/restore", { preHandler: requireAdmin }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await transaction(async (client) => {
      const result = await client.query<{ current_revision_id: string | null }>(
        "SELECT current_revision_id FROM map_features WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
        [params.id]
      );
      const feature = result.rows[0];
      if (!feature) throw notFound("Feature not found");
      if (!feature.current_revision_id) throw conflict("Feature has no approved revision");
      await client.query("UPDATE map_features SET status = 'published', updated_at = now() WHERE id = $1", [params.id]);
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "feature.restored",
        resourceType: "feature",
        resourceId: params.id
      });
    });
    return { status: "published" };
  });

  app.post("/moderation/comments/:id/approve", { preHandler: requireModerator }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await transaction(async (client) => {
      const actor = await resolveScopedActor(client, request.user!);
      const pending = await client.query<{ author_id: string; status: string } & ScopeTargetRow>(
        `SELECT c.author_id, c.status, mf.category_key,
                ST_X(mf.geom::geometry) AS longitude, ST_Y(mf.geom::geometry) AS latitude
         FROM comments c
         JOIN map_features mf ON mf.id = c.feature_id
         WHERE c.id = $1 AND c.status = 'pending' AND c.deleted_at IS NULL
         FOR UPDATE OF c`,
        [params.id]
      );
      const comment = pending.rows[0];
      if (!comment) throw notFound("Pending comment not found");
      assertScopedPermission(actor, "comment.approve", comment);
      await client.query(
        `UPDATE comments SET status = 'published', reviewed_at = now(), reviewer_id = $2,
             rejection_reason_code = NULL, updated_at = now() WHERE id = $1`,
        [params.id, request.user!.id]
      );
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "comment.approved",
        resourceType: "comment",
        resourceId: params.id,
        metadata: {}
      });
      await notifyUser(client, {
        userId: comment.author_id,
        type: "comment_approved",
        title: "你的评论已通过审核",
        body: "评论已公开显示。",
        link: "/me/comments"
      });
    });
    return { status: "published" };
  });

  app.post("/moderation/comments/:id/reject", { preHandler: requireModerator }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = moderationDecisionSchema.parse(request.body);
    await transaction(async (client) => {
      const actor = await resolveScopedActor(client, request.user!);
      const pending = await client.query<{ author_id: string } & ScopeTargetRow>(
        `SELECT c.author_id, mf.category_key,
                ST_X(mf.geom::geometry) AS longitude, ST_Y(mf.geom::geometry) AS latitude
         FROM comments c
         JOIN map_features mf ON mf.id = c.feature_id
         WHERE c.id = $1 AND c.status IN ('pending', 'published') AND c.deleted_at IS NULL
         FOR UPDATE OF c`,
        [params.id]
      );
      const comment = pending.rows[0];
      if (!comment) throw notFound("Comment not found");
      const check = assertScopedPermission(actor, "comment.reject", comment);
      await client.query(
        `UPDATE comments SET status = 'rejected', reviewed_at = now(), reviewer_id = $2,
             rejection_reason_code = $3, updated_at = now() WHERE id = $1`,
        [params.id, request.user!.id, input.reasonCode]
      );
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "comment.rejected",
        resourceType: "comment",
        resourceId: params.id,
        metadata: { reasonCode: input.reasonCode, notes: input.notes, ...scopeMeta(check) }
      });
      await notifyUser(client, {
        userId: comment.author_id,
        type: "comment_rejected",
        title: "你的评论未通过审核",
        body: `${input.reasonCode}${input.notes ? `：${input.notes}` : ""}`,
        link: "/me/comments"
      });
    });
    return { status: "rejected" };
  });

  app.post("/moderation/comments/:id/hide", { preHandler: requireModerator }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = moderationDecisionSchema.parse(request.body);
    await transaction(async (client) => {
      const actor = await resolveScopedActor(client, request.user!);
      const pending = await client.query<ScopeTargetRow>(
        `SELECT mf.category_key, ST_X(mf.geom::geometry) AS longitude, ST_Y(mf.geom::geometry) AS latitude
         FROM comments c
         JOIN map_features mf ON mf.id = c.feature_id
         WHERE c.id = $1 AND c.deleted_at IS NULL
         FOR UPDATE OF c`,
        [params.id]
      );
      const target = pending.rows[0];
      if (!target) throw notFound("Comment not found");
      const check = assertScopedPermission(actor, "comment.hide", target);
      const updated = await client.query(
        "UPDATE comments SET status = 'hidden', updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
        [params.id]
      );
      if (!updated.rowCount) throw notFound("Comment not found");
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "comment.hidden",
        resourceType: "comment",
        resourceId: params.id,
        metadata: { reasonCode: input.reasonCode, notes: input.notes, ...scopeMeta(check) }
      });
    });
    return { status: "hidden" };
  });

  app.post("/moderation/reports/:id/resolve", { preHandler: requireModerator }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({
      status: z.enum(["resolved", "dismissed"]),
      action: z.enum(["none", "hide", "restore"]).default("none"),
      notes: z.string().trim().max(1000).optional()
    }).parse(request.body);

    await transaction(async (client) => {
      const actor = await resolveScopedActor(client, request.user!);
      const reportResult = await client.query<{ target_type: string; target_id: string; reporter_id: string }>(
        "SELECT target_type, target_id, reporter_id FROM reports WHERE id = $1 AND status = 'open' FOR UPDATE",
        [params.id]
      );
      const report = reportResult.rows[0];
      if (!report) throw notFound("Open report not found");

      // 解析举报目标的分类与坐标，用于委托范围校验。
      const targetResult =
        report.target_type === "feature"
          ? await client.query<ScopeTargetRow>(
              `SELECT category_key, ST_X(geom::geometry) AS longitude, ST_Y(geom::geometry) AS latitude
               FROM map_features WHERE id = $1 AND deleted_at IS NULL`,
              [report.target_id]
            )
          : await client.query<ScopeTargetRow>(
              `SELECT mf.category_key, ST_X(mf.geom::geometry) AS longitude, ST_Y(mf.geom::geometry) AS latitude
               FROM comments c JOIN map_features mf ON mf.id = c.feature_id
               WHERE c.id = $1 AND c.deleted_at IS NULL AND mf.deleted_at IS NULL`,
              [report.target_id]
            );
      const target = targetResult.rows[0] ?? null;

      if (input.action === "restore" && !actor.isAdmin) {
        throw forbidden("恢复内容仅限管理员，不能通过临时委托执行");
      }

      // “隐藏”按目标类型检查对应隐藏权限；其余动作检查举报处理权限。
      // 目标已删除时没有分类/坐标，只能由管理员或“全分类、无地区限制”的委托处理。
      let check: PermissionCheck;
      if (input.action === "hide") {
        if (!target) throw notFound("Reported target no longer exists");
        check = assertScopedPermission(
          actor,
          report.target_type === "feature" ? "feature.hide" : "comment.hide",
          target
        );
      } else {
        check = assertScopedPermission(actor, "report.resolve", target ?? {});
      }

      if (input.action === "hide") {
        const table = report.target_type === "feature" ? "map_features" : "comments";
        await client.query(`UPDATE ${table} SET status = 'hidden', updated_at = now() WHERE id = $1`, [report.target_id]);
      }
      if (input.action === "restore") {
        if (report.target_type === "feature") {
          await client.query("UPDATE map_features SET status = 'published', updated_at = now() WHERE id = $1 AND current_revision_id IS NOT NULL", [report.target_id]);
        } else {
          await client.query("UPDATE comments SET status = 'published', updated_at = now() WHERE id = $1", [report.target_id]);
        }
      }

      await client.query(
        `UPDATE reports SET status = $2, resolved_by = $3, resolved_at = now() WHERE id = $1`,
        [params.id, input.status, request.user!.id]
      );
      await recordAudit(client, {
        actorId: request.user!.id,
        action: "report.resolved",
        resourceType: "report",
        resourceId: params.id,
        metadata: {
          status: input.status,
          action: input.action,
          notes: input.notes,
          targetType: report.target_type,
          targetId: report.target_id,
          ...scopeMeta(check)
        }
      });
      await notifyUser(client, {
        userId: report.reporter_id,
        type: "report_resolved",
        title: "你的举报已处理",
        body: input.status === "resolved" ? "审核员已完成处理。" : "审核员已完成核查，本次举报被驳回。",
        link: "/me/notifications"
      });
    });
    return { status: input.status };
  });

  app.get("/moderation/audit", { preHandler: requireAdmin }, async (request) => {
    const input = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(100),
      resourceType: z.string().optional(),
      action: z.string().optional(),
      delegationOnly: z.coerce.boolean().optional()
    }).parse(request.query);
    const values: unknown[] = [input.limit];
    const conditions: string[] = [];
    if (input.resourceType) {
      values.push(input.resourceType);
      conditions.push(`al.resource_type = $${values.length}`);
    }
    if (input.action) {
      values.push(`${input.action}%`);
      conditions.push(`al.action LIKE $${values.length}`);
    }
    if (input.delegationOnly) {
      conditions.push("(al.metadata ? 'delegationId' OR al.action LIKE 'delegation.%')");
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `SELECT al.id, al.actor_id, u.display_name AS actor_name, al.action,
              al.resource_type, al.resource_id, al.metadata, al.created_at
       FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id
       ${where}
       ORDER BY al.created_at DESC LIMIT $1`,
      values
    );
    return result.rows;
  });
}

async function activePendingRevision(
  client: Parameters<Parameters<typeof transaction>[0]>[0],
  featureId: string
) {
  const result = await client.query<{
    id: string;
    author_id: string;
    payload: { categoryKey: string; longitude: number; latitude: number };
  }>(
    `SELECT fr.id, fr.author_id, fr.payload
     FROM feature_revisions fr
     WHERE fr.feature_id = $1 AND fr.status = 'pending'
     ORDER BY fr.revision_no DESC LIMIT 1 FOR UPDATE`,
    [featureId]
  );
  const revision = result.rows[0];
  if (!revision) throw notFound("Pending revision not found");
  return revision;
}
