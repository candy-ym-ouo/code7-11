import { beforeAll, describe, expect, it } from "vitest";
import type { DelegationScope, ScopePoint } from "./delegation";

let delegation: typeof import("./delegation");

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://map:map@localhost:5432/map";
  process.env.S3_ENDPOINT = "http://localhost:9000";
  process.env.S3_PUBLIC_ENDPOINT = "http://localhost:9000";
  process.env.S3_ACCESS_KEY = "test";
  process.env.S3_SECRET_KEY = "test";
  process.env.S3_QUARANTINE_BUCKET = "quarantine";
  process.env.S3_PUBLIC_BUCKET = "public";
  process.env.PUBLIC_MEDIA_BASE_URL = "http://localhost:9000/public";
  process.env.JWT_ACCESS_SECRET = "test-secret-that-is-long-enough-32";
  delegation = await import("./delegation");
});

const benchInHaidian: ScopePoint = { categoryKey: "bench", longitude: 116.3, latitude: 39.98 };
const waterInChaoyang: ScopePoint = { categoryKey: "drinking_water", longitude: 116.48, latitude: 39.95 };

const haidianBenchScope: DelegationScope = {
  id: "d1",
  categoryKeys: ["bench"],
  region: { minLon: 116.2, minLat: 39.9, maxLon: 116.4, maxLat: 40.05 },
  regionName: "海淀区",
  allowHighRisk: false,
  expiresAt: new Date(Date.now() + 3600_000)
};

describe("delegationCovers", () => {
  it("covers points inside the category and region scope", () => {
    expect(delegation.delegationCovers(haidianBenchScope, benchInHaidian)).toBe(true);
  });

  it("rejects categories outside the delegation", () => {
    expect(delegation.delegationCovers(haidianBenchScope, waterInChaoyang)).toBe(false);
    expect(delegation.delegationCovers(haidianBenchScope, { ...benchInHaidian, categoryKey: "drinking_water" })).toBe(false);
  });

  it("rejects points outside the region bbox", () => {
    expect(delegation.delegationCovers(haidianBenchScope, { ...benchInHaidian, longitude: 116.5 })).toBe(false);
    expect(delegation.delegationCovers(haidianBenchScope, { ...benchInHaidian, latitude: 39.8 })).toBe(false);
  });

  it("treats empty categoryKeys and null region as wildcards", () => {
    const wildcard: DelegationScope = { ...haidianBenchScope, categoryKeys: [], region: null };
    expect(delegation.delegationCovers(wildcard, waterInChaoyang)).toBe(true);
  });

  it("requires allowHighRisk for high-risk operations", () => {
    expect(delegation.delegationCovers(haidianBenchScope, benchInHaidian, { highRisk: true })).toBe(false);
    const highRisk: DelegationScope = { ...haidianBenchScope, allowHighRisk: true };
    expect(delegation.delegationCovers(highRisk, benchInHaidian, { highRisk: true })).toBe(true);
  });
});

describe("findCoveringDelegation", () => {
  it("returns the first delegation covering the point", () => {
    const other: DelegationScope = { ...haidianBenchScope, id: "d2", categoryKeys: ["drinking_water"] };
    expect(delegation.findCoveringDelegation([haidianBenchScope, other], waterInChaoyang)).toBeNull();
    expect(delegation.findCoveringDelegation([haidianBenchScope, other], benchInHaidian)?.id).toBe("d1");
  });
});

describe("buildQueueScopeFilter", () => {
  const columns = { categorySql: "mf.category_key", longitudeSql: "ST_X(mf.geom::geometry)", latitudeSql: "ST_Y(mf.geom::geometry)" };

  it("returns FALSE when there are no delegations", () => {
    const filter = delegation.buildQueueScopeFilter([], columns, 1);
    expect(filter.sql).toBe("FALSE");
    expect(filter.values).toEqual([]);
  });

  it("builds OR branches with category and bbox parameters", () => {
    const wildcard: DelegationScope = { ...haidianBenchScope, id: "d2", categoryKeys: [], region: null };
    const filter = delegation.buildQueueScopeFilter([haidianBenchScope, wildcard], columns, 1);
    expect(filter.sql).toContain("mf.category_key = ANY($1::text[])");
    expect(filter.sql).toContain("ST_X(mf.geom::geometry) BETWEEN $2 AND $3");
    expect(filter.sql).toContain("ST_Y(mf.geom::geometry) BETWEEN $4 AND $5");
    expect(filter.sql).toContain("cardinality($6::text[]) = 0");
    expect(filter.sql).toContain(" OR ");
    expect(filter.values).toEqual([
      ["bench"], 116.2, 116.4, 39.9, 40.05,
      []
    ]);
    expect(filter.nextIndex).toBe(7);
  });
});
