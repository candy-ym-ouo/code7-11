import type { PoolClient } from "pg";
import {
  isHighRiskPermission,
  scopeAllows,
  type DelegationRegion,
  type DelegationScope,
  type ModerationPermission
} from "@map/shared/contracts";
import { forbidden } from "./errors";
import type { AuthUser } from "./auth";

export type DelegationRow = {
  id: string;
  grantee_id: string;
  granted_by: string;
  permissions: ModerationPermission[];
  category_keys: string[] | null;
  region_geojson: DelegationRegion | null;
  reason: string;
  valid_until: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: Date;
};

/**
 * 加载用户当前仍有效的全部委托（未撤销、未过期）。
 * 审核员的审核能力完全由这些委托决定；没有委托就不能执行任何审核动作。
 */
export async function loadActiveScopes(
  client: PoolClient,
  userId: string
): Promise<(DelegationScope & { delegationId: string })[]> {
  const result = await client.query<{
    id: string;
    permissions: ModerationPermission[];
    category_keys: string[] | null;
    region_geojson: DelegationRegion | null;
  }>(
    `SELECT id, permissions, category_keys, region_geojson
     FROM moderation_delegations
     WHERE grantee_id = $1 AND revoked_at IS NULL AND valid_until > now()`,
    [userId]
  );
  return result.rows.map((row) => ({
    delegationId: row.id,
    permissions: row.permissions,
    categoryKeys: row.category_keys ?? [],
    region: row.region_geojson
  }));
}

export type ScopedActor = {
  user: AuthUser;
  isAdmin: boolean;
  scopes: (DelegationScope & { delegationId: string })[];
};

/**
 * 在事务中解析当前操作者的有效范围。管理员不受委托限制（isAdmin 放行）。
 */
export async function resolveScopedActor(client: PoolClient, user: AuthUser): Promise<ScopedActor> {
  const isAdmin = user.role === "admin";
  return { user, isAdmin, scopes: isAdmin ? [] : await loadActiveScopes(client, user.id) };
}

export type PermissionCheck = {
  delegationId?: string;
  highRisk: boolean;
};

/**
 * 服务端越权拒绝：管理员放行；审核员必须持有覆盖该分类与地区的有效委托。
 * 页面层（Web）只负责隐藏入口，真正的拒绝在这里强制执行。
 */
export function assertScopedPermission(
  actor: { isAdmin: boolean; scopes: (DelegationScope & { delegationId: string })[] },
  permission: ModerationPermission,
  target: { categoryKey?: string | null; longitude?: number | null; latitude?: number | null }
): PermissionCheck {
  if (actor.isAdmin) return { highRisk: false };
  const match = actor.scopes.find((scope) =>
    scopeAllows(scope, permission, target)
  );
  if (!match) {
    throw forbidden("该动作不在你的临时审核范围内（分类或地区不匹配，或委托已过期）");
  }
  return { delegationId: match.delegationId, highRisk: isHighRiskPermission(permission) };
}

/**
 * 构造“存在一条有效委托覆盖该动作”的 SQL 片段，用于审核队列按范围过滤。
 * @param actorIdParam 操作者 ID 的参数占位符，例如 "$1"
 * @param permissionParam 权限名的参数占位符，例如 "$2"（以 ::moderation_permission 绑定）
 * @param categoryExpression 目标分类的列/SQL 表达式
 * @param pointExpression 目标点（geography 或 geometry）的表达式
 */
export function scopeExistenceClause(
  actorIdParam: string,
  permissionParam: string,
  categoryExpression: string,
  pointExpression: string,
  scopeAlias = "md"
): string {
  return `EXISTS (
    SELECT 1 FROM moderation_delegations ${scopeAlias}
    WHERE ${scopeAlias}.grantee_id = ${actorIdParam}
      AND ${scopeAlias}.revoked_at IS NULL
      AND ${scopeAlias}.valid_until > now()
      AND ${permissionParam}::moderation_permission = ANY(${scopeAlias}.permissions)
      AND (
        ${scopeAlias}.category_keys IS NULL
        OR ${categoryExpression} = ANY(${scopeAlias}.category_keys)
      )
      AND (
        ${scopeAlias}.region IS NULL
        OR ST_Covers(${scopeAlias}.region, ${pointExpression})
      )
  )`;
}

/** 解析媒体的范围目标：挂到待审修订跟随待审 payload，否则取最新关联地点；孤立媒体返回全 null 且 orphan=true。 */
export async function mediaScopeTarget(
  client: PoolClient,
  mediaId: string
): Promise<{ categoryKey: string | null; longitude: number | null; latitude: number | null; orphan: boolean }> {
  const result = await client.query<{
    category_key: string | null;
    longitude: number | null;
    latitude: number | null;
    orphan: boolean;
  }>(
    `SELECT
       COALESCE(frp.payload->>'categoryKey', mf.category_key) AS category_key,
       COALESCE((frp.payload->>'longitude')::float8, ST_X(mf.geom::geometry)) AS longitude,
       COALESCE((frp.payload->>'latitude')::float8, ST_Y(mf.geom::geometry)) AS latitude,
       (picked.pending_feature_id IS NULL AND picked.latest_feature_id IS NULL) AS orphan
     FROM (
       SELECT
         (
           SELECT fr_pending.feature_id
           FROM revision_media rm_p
           JOIN feature_revisions fr_pending ON fr_pending.id = rm_p.revision_id
           WHERE rm_p.media_id = $1 AND fr_pending.status = 'pending'
           ORDER BY fr_pending.submitted_at DESC
           LIMIT 1
         ) AS pending_feature_id,
         (
           SELECT mf_latest.id
           FROM revision_media rm_l
           JOIN feature_revisions fr_latest ON fr_latest.id = rm_l.revision_id
           JOIN map_features mf_latest ON mf_latest.id = fr_latest.feature_id
           WHERE rm_l.media_id = $1 AND mf_latest.deleted_at IS NULL
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
     LEFT JOIN map_features mf
       ON mf.id = COALESCE(picked.pending_feature_id, picked.latest_feature_id)`,
    [mediaId]
  );
  const row = result.rows[0];
  return {
    categoryKey: row?.category_key ?? null,
    longitude: row?.longitude ?? null,
    latitude: row?.latitude ?? null,
    orphan: Boolean(row?.orphan)
  };
}

/** 序列化委托行，供管理接口与“我的范围”接口返回。 */
export function serializeDelegation(row: DelegationRow, now: Date = new Date()) {
  const status =
    row.revoked_at ? "revoked" : row.valid_until.getTime() < now.getTime() ? "expired" : "active";
  return {
    id: row.id,
    granteeId: row.grantee_id,
    grantedBy: row.granted_by,
    permissions: row.permissions,
    categoryKeys: row.category_keys ?? [],
    region: row.region_geojson,
    reason: row.reason,
    validUntil: row.valid_until,
    status,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revokeReason: row.revoke_reason,
    createdAt: row.created_at
  };
}
