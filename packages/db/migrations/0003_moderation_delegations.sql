-- 审核权限委托：管理员按分类与地区向审核员授予临时审核范围。
-- 有效期不超过 30 天；可提前撤销。范围判断只认当前仍有效的委托。
-- 注意：CHECK 约束不能包含子查询，grantee 必须是审核员、不能自委托等规则在服务端校验。

CREATE TYPE moderation_permission AS ENUM (
  'feature.approve',
  'feature.reject',
  'feature.request_changes',
  'feature.hide',
  'comment.approve',
  'comment.reject',
  'comment.hide',
  'media.privacy_approve',
  'report.resolve'
);

CREATE TABLE moderation_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantee_id uuid NOT NULL REFERENCES users(id),
  granted_by uuid NOT NULL REFERENCES users(id),
  permissions moderation_permission[] NOT NULL,
  -- NULL 表示全部五个分类；非 NULL 时每个 key 必须存在于 categories（服务端校验）。
  category_keys text[],
  region_geojson jsonb,
  region geometry(Polygon, 4326),
  reason text NOT NULL,
  valid_until timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 行内 grantee_id 与 granted_by 不能相同（管理员不能自委托）；
  -- 同一对授予者/被授予者可以并存多条不同范围的委托。
  CONSTRAINT moderation_delegations_no_self_chk CHECK (grantee_id <> granted_by),
  CONSTRAINT moderation_delegations_permissions_chk
    CHECK (array_length(permissions, 1) IS NOT NULL AND array_length(permissions, 1) <= 20),
  -- 允许 1 小时时钟漂移余量；上限由服务端严格执行 30 天。
  CONSTRAINT moderation_delegations_duration_chk
    CHECK (valid_until > created_at AND valid_until <= created_at + interval '31 days')
);

CREATE INDEX moderation_delegations_grantee_active_idx
  ON moderation_delegations(grantee_id, valid_until)
  WHERE revoked_at IS NULL;
CREATE INDEX moderation_delegations_granted_by_idx
  ON moderation_delegations(granted_by, created_at DESC);
-- 地区包含判断走 GiST 空间索引。
CREATE INDEX moderation_delegations_region_gix
  ON moderation_delegations USING gist (region)
  WHERE region IS NOT NULL;

-- 委托授予/撤销写入 audit_logs(resource_type='moderation_delegation')，
-- 高风险审核动作（拒绝、隐藏、举报处理、隐私确认）也写入同一审计流。
