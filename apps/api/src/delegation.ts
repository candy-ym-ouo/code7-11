import { query } from "./db";
import { AppError } from "./errors";
import type { AuthUser } from "./auth";
import type { DelegationRegion } from "@map/shared/contracts";

export type DelegationScope = {
  id: string;
  categoryKeys: string[];
  region: DelegationRegion | null;
  regionName: string | null;
  allowHighRisk: boolean;
  expiresAt: Date;
};

export type ScopePoint = {
  categoryKey: string;
  longitude: number;
  latitude: number;
};

export class ScopeExceededError extends AppError {
  constructor(message = "Operation is outside the delegated moderation scope") {
    super(403, "DELEGATION_SCOPE_EXCEEDED", message);
  }
}

type DelegationRow = {
  id: string;
  category_keys: string[];
  region: DelegationRegion | null;
  region_name: string | null;
  allow_high_risk: boolean;
  expires_at: Date;
};

function toScope(row: DelegationRow): DelegationScope {
  return {
    id: row.id,
    categoryKeys: row.category_keys ?? [],
    region: row.region,
    regionName: row.region_name,
    allowHighRisk: row.allow_high_risk,
    expiresAt: row.expires_at
  };
}

export async function loadActiveDelegations(userId: string, now = new Date()): Promise<DelegationScope[]> {
  const result = await query<DelegationRow>(
    `SELECT id, category_keys, region, region_name, allow_high_risk, expires_at
     FROM moderation_delegations
     WHERE delegate_id = $1 AND status = 'active' AND expires_at > $2
     ORDER BY created_at ASC`,
    [userId, now]
  );
  return result.rows.map(toScope);
}

/** 纯函数：单条委托是否覆盖目标内容。categoryKeys 为空表示全部分类，region 为空表示不限地区。 */
export function delegationCovers(
  scope: Pick<DelegationScope, "categoryKeys" | "region" | "allowHighRisk">,
  point: ScopePoint,
  options: { highRisk?: boolean } = {}
): boolean {
  if (options.highRisk && !scope.allowHighRisk) return false;
  if (scope.categoryKeys.length > 0 && !scope.categoryKeys.includes(point.categoryKey)) return false;
  if (scope.region) {
    const { minLon, minLat, maxLon, maxLat } = scope.region;
    if (point.longitude < minLon || point.longitude > maxLon) return false;
    if (point.latitude < minLat || point.latitude > maxLat) return false;
  }
  return true;
}

export function findCoveringDelegation(
  delegations: DelegationScope[],
  point: ScopePoint,
  options: { highRisk?: boolean } = {}
): DelegationScope | null {
  return delegations.find((scope) => delegationCovers(scope, point, options)) ?? null;
}

/**
 * 接口层越权拒绝：管理员不受限；审核员必须持有覆盖目标分类与地区的有效委托，
 * 高风险操作还要求委托带 allow_high_risk。拒绝时写入 moderation.scope_denied 审计。
 */
export async function assertModerationScope(
  user: AuthUser,
  point: ScopePoint,
  options: { highRisk?: boolean; action: string }
): Promise<void> {
  if (user.role === "admin") return;
  const delegations = await loadActiveDelegations(user.id);
  if (findCoveringDelegation(delegations, point, options)) return;
  await query(
    `INSERT INTO audit_logs(actor_id, action, resource_type, resource_id, metadata)
     VALUES ($1, 'moderation.scope_denied', 'delegation', NULL, $2::jsonb)`,
    [
      user.id,
      JSON.stringify({
        attemptedAction: options.action,
        highRisk: Boolean(options.highRisk),
        categoryKey: point.categoryKey,
        longitude: point.longitude,
        latitude: point.latitude
      })
    ]
  );
  throw new ScopeExceededError();
}

/** 媒体隐私确认属于高风险但与分类/地区无关：要求任意有效的 allow_high_risk 委托。 */
export async function assertMediaPrivacyScope(user: AuthUser, action: string): Promise<void> {
  if (user.role === "admin") return;
  const delegations = await loadActiveDelegations(user.id);
  if (delegations.some((scope) => scope.allowHighRisk)) return;
  await query(
    `INSERT INTO audit_logs(actor_id, action, resource_type, resource_id, metadata)
     VALUES ($1, 'moderation.scope_denied', 'delegation', NULL, $2::jsonb)`,
    [user.id, JSON.stringify({ attemptedAction: action, highRisk: true, mediaPrivacy: true })]
  );
  throw new ScopeExceededError("Media privacy approval requires a high-risk delegation");
}

export async function hasAnyActiveDelegation(user: AuthUser): Promise<boolean> {
  if (user.role === "admin") return true;
  return (await loadActiveDelegations(user.id)).length > 0;
}

/** 查看私有审核证据（如媒体预览）要求持有任意有效委托；拒绝同样写审计。 */
export async function assertAnyDelegation(user: AuthUser, action: string): Promise<void> {
  if (await hasAnyActiveDelegation(user)) return;
  await query(
    `INSERT INTO audit_logs(actor_id, action, resource_type, resource_id, metadata)
     VALUES ($1, 'moderation.scope_denied', 'delegation', NULL, $2::jsonb)`,
    [user.id, JSON.stringify({ attemptedAction: action, noActiveDelegation: true })]
  );
  throw new ScopeExceededError("An active delegation is required for moderation work");
}

/**
 * 为审核队列生成 SQL 过滤片段。列表达式由调用方给出（必须是代码内常量，不接受用户输入）。
 * 每个委托展开为一个 OR 分支：分类匹配 AND (无地区限制 OR 点位落在 bbox 内)。
 */
export function buildQueueScopeFilter(
  delegations: DelegationScope[],
  columns: { categorySql: string; longitudeSql: string; latitudeSql: string },
  startIndex: number
): { sql: string; values: unknown[]; nextIndex: number } {
  if (delegations.length === 0) return { sql: "FALSE", values: [], nextIndex: startIndex };
  const values: unknown[] = [];
  const branches: string[] = [];
  let index = startIndex;
  for (const scope of delegations) {
    values.push(scope.categoryKeys);
    const categoryParam = index++;
    let branch = `(cardinality($${categoryParam}::text[]) = 0 OR ${columns.categorySql} = ANY($${categoryParam}::text[]))`;
    if (scope.region) {
      values.push(scope.region.minLon, scope.region.maxLon, scope.region.minLat, scope.region.maxLat);
      const [minLon, maxLon, minLat, maxLat] = [index++, index++, index++, index++];
      branch += ` AND (${columns.longitudeSql} BETWEEN $${minLon} AND $${maxLon} AND ${columns.latitudeSql} BETWEEN $${minLat} AND $${maxLat})`;
    }
    branches.push(`(${branch})`);
  }
  return { sql: branches.join(" OR "), values, nextIndex: index };
}
