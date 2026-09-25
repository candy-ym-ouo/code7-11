import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../migrations/0001_init.sql"),
  "utf8"
);

describe("initial migration", () => {
  it("contains the core audited entities", () => {
    for (const table of [
      "users", "sessions", "auth_tokens", "categories", "map_features",
      "feature_revisions", "media_assets", "comments", "reports",
      "moderation_actions", "outbox_events", "audit_logs", "notifications"
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
  });

  it("adds public thumbnail and outbox recovery fields in migration 0002", () => {
    const followup = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../migrations/0002_media_public_thumb.sql"),
      "utf8"
    );
    expect(followup).toContain("public_thumbnail_object_key");
    expect(followup).toContain("updated_at timestamptz");
  });

  it("creates scoped, temporary moderation delegations in migration 0003", () => {
    const delegation = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../migrations/0003_moderation_delegations.sql"),
      "utf8"
    );
    expect(delegation).toContain("CREATE TYPE moderation_permission AS ENUM");
    expect(delegation).toContain("CREATE TABLE moderation_delegations");
    for (const permission of [
      "feature.approve",
      "feature.reject",
      "feature.request_changes",
      "feature.hide",
      "comment.approve",
      "comment.reject",
      "comment.hide",
      "media.privacy_approve",
      "report.resolve"
    ]) {
      expect(delegation).toContain(`'${permission}'`);
    }
    // 委托范围由分类数组、地理多边形和有效期共同界定，且支持撤销。
    expect(delegation).toContain("category_keys text[]");
    expect(delegation).toContain("region geometry(Polygon, 4326)");
    expect(delegation).toContain("valid_until timestamptz");
    expect(delegation).toContain("revoked_at timestamptz");
    // 不能自委托；有效期上限受控。
    expect(delegation).toContain("grantee_id <> granted_by");
    expect(delegation).toContain("interval '31 days'");
    // 空间包含判断使用 GiST 索引。
    expect(delegation).toContain("USING gist (region)");
  });

  it("uses PostGIS geography points and spatial indexes", () => {
    expect(migration).toContain("geography(Point, 4326)");
    expect(migration).toContain("USING gist (geom)");
  });
});
