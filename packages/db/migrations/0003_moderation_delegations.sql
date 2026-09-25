-- 审核权限委托：管理员按分类和地区向审核员授予临时审核范围。
-- 委托、撤销与高风险审核操作统一写入 audit_logs。

CREATE TABLE moderation_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grantor_id uuid NOT NULL REFERENCES users(id),
  -- 空数组表示全部分类；否则仅列出的分类键可审核。
  category_keys text[] NOT NULL DEFAULT '{}',
  -- NULL 表示不限地区；否则为 { minLon, minLat, maxLon, maxLat } 的 bbox。
  region jsonb,
  region_name text,
  -- 是否允许高风险操作（隐藏、隐私确认发布等）。
  allow_high_risk boolean NOT NULL DEFAULT false,
  note text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_delegations_region_shape CHECK (
    region IS NULL OR (
      jsonb_typeof(region) = 'object'
      AND (region->>'minLon')::double precision BETWEEN -180 AND 180
      AND (region->>'maxLon')::double precision BETWEEN -180 AND 180
      AND (region->>'minLat')::double precision BETWEEN -90 AND 90
      AND (region->>'maxLat')::double precision BETWEEN -90 AND 90
      AND (region->>'minLon')::double precision < (region->>'maxLon')::double precision
      AND (region->>'minLat')::double precision < (region->>'maxLat')::double precision
    )
  )
  -- 分类键的合法性由应用层按 categories 表校验（CHECK 不允许子查询）。
);
CREATE INDEX moderation_delegations_delegate_idx
  ON moderation_delegations(delegate_id, expires_at)
  WHERE status = 'active';
CREATE INDEX moderation_delegations_expiry_idx
  ON moderation_delegations(status, expires_at);
