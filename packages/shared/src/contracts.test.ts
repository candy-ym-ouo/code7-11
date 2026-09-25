import { describe, expect, it } from "vitest";
import {
  delegationCreateSchema,
  delegationRegionSchema,
  featurePayloadSchema,
  isHighRiskPermission,
  pointInBBox,
  pointInPolygon,
  pointInRegion,
  privacyRegionSchema,
  regionToPolygonGeoJson,
  scopeAllows,
  scopesAllow,
  type DelegationScope
} from "./contracts";

describe("featurePayloadSchema", () => {
  it("accepts a valid bench", () => {
    const result = featurePayloadSchema.safeParse({
      categoryKey: "bench",
      title: "公园南侧长椅",
      description: "靠近入口，有两张长椅和靠背。",
      longitude: 116.39,
      latitude: 39.9,
      locationAccuracyM: 5,
      observedAt: new Date().toISOString(),
      condition: "good",
      tags: ["休息"],
      details: { seatCount: 2, hasBackrest: true },
      mediaIds: []
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown detail fields for the selected category", () => {
    const result = featurePayloadSchema.safeParse({
      categoryKey: "bench",
      title: "公园长椅",
      description: "这是一条足够长的说明文字。",
      longitude: 116.39,
      latitude: 39.9,
      locationAccuracyM: 5,
      observedAt: new Date().toISOString(),
      condition: "good",
      tags: [],
      details: { potable: "yes", seatCount: "many" },
      mediaIds: []
    });
    expect(result.success).toBe(false);
  });
});

describe("privacyRegionSchema", () => {
  it("rejects regions outside the image", () => {
    expect(privacyRegionSchema.safeParse({ x: 0.9, y: 0.2, width: 0.2, height: 0.2 }).success).toBe(false);
  });
});

describe("feature media ids", () => {
  it("rejects duplicate media attachments", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const result = featurePayloadSchema.safeParse({
      categoryKey: "bench",
      title: "公园长椅",
      description: "这是一条足够长的说明文字。",
      longitude: 116.39,
      latitude: 39.9,
      locationAccuracyM: 5,
      observedAt: new Date().toISOString(),
      condition: "good",
      tags: [],
      details: { seatCount: 1 },
      mediaIds: [id, id]
    });
    expect(result.success).toBe(false);
  });
});

describe("delegation region schema", () => {
  it("accepts a valid bbox", () => {
    expect(
      delegationRegionSchema.safeParse({ type: "bbox", bbox: [116.3, 39.8, 116.5, 40.0] }).success
    ).toBe(true);
  });

  it("rejects an inverted bbox", () => {
    expect(
      delegationRegionSchema.safeParse({ type: "bbox", bbox: [116.5, 40.0, 116.3, 39.8] }).success
    ).toBe(false);
  });

  it("rejects an unclosed polygon ring", () => {
    expect(
      delegationRegionSchema.safeParse({
        type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1]]]
      }).success
    ).toBe(false);
  });

  it("rejects an unknown region type", () => {
    expect(delegationRegionSchema.safeParse({ type: "circle", center: [0, 0] }).success).toBe(false);
  });
});

describe("point-in-region geometry", () => {
  const bbox = [0, 0, 2, 2] as const;
  const square: DelegationScope["region"] = {
    type: "Polygon",
    coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]
  };
  const squareWithHole: DelegationScope["region"] = {
    type: "Polygon",
    coordinates: [
      [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
      [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]
    ]
  };

  it("checks bbox membership including borders", () => {
    expect(pointInBBox(1, 1, bbox)).toBe(true);
    expect(pointInBBox(2, 2, bbox)).toBe(true);
    expect(pointInBBox(2.1, 1, bbox)).toBe(false);
  });

  it("checks polygon membership with ray casting", () => {
    expect(pointInPolygon(1, 1, square!.coordinates)).toBe(true);
    expect(pointInPolygon(3, 3, square!.coordinates)).toBe(false);
  });

  it("treats holes as outside", () => {
    expect(pointInRegion(2, 2, squareWithHole!)).toBe(false);
    expect(pointInRegion(0.5, 0.5, squareWithHole!)).toBe(true);
  });

  it("converts bbox to a closed polygon", () => {
    const polygon = regionToPolygonGeoJson({ type: "bbox", bbox });
    const ring = polygon.coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(pointInRegion(1, 1, polygon)).toBe(true);
  });
});

describe("scopeAllows", () => {
  const benchScope: DelegationScope = {
    permissions: ["feature.approve", "feature.reject"],
    categoryKeys: ["bench"],
    region: { type: "bbox", bbox: [0, 0, 2, 2] }
  };
  const allScope: DelegationScope = {
    permissions: ["feature.hide", "report.resolve"],
    categoryKeys: [],
    region: null
  };

  it("denies when the permission is not granted", () => {
    expect(scopeAllows(benchScope, "feature.hide", { categoryKey: "bench", longitude: 1, latitude: 1 })).toBe(false);
  });

  it("denies when the category is outside the delegation", () => {
    expect(scopeAllows(benchScope, "feature.approve", { categoryKey: "drinking_water", longitude: 1, latitude: 1 })).toBe(false);
  });

  it("denies when the point is outside the region", () => {
    expect(scopeAllows(benchScope, "feature.approve", { categoryKey: "bench", longitude: 9, latitude: 9 })).toBe(false);
  });

  it("allows when permission, category and region all match", () => {
    expect(scopeAllows(benchScope, "feature.reject", { categoryKey: "bench", longitude: 2, latitude: 2 })).toBe(true);
  });

  it("treats empty categories as all categories and null region as unrestricted", () => {
    expect(scopeAllows(allScope, "feature.hide", { categoryKey: "night_lighting", longitude: 90, latitude: 45 })).toBe(true);
  });

  it("requires coordinates when a region is constrained", () => {
    expect(scopeAllows(benchScope, "feature.approve", { categoryKey: "bench" })).toBe(false);
  });

  it("returns the matching scope across multiple delegations", () => {
    const match = scopesAllow([benchScope, allScope], "report.resolve", {
      categoryKey: "bench",
      longitude: 9,
      latitude: 9
    });
    expect(match?.permissions).toContain("report.resolve");
    expect(scopesAllow([benchScope], "feature.hide", { categoryKey: "bench", longitude: 1, latitude: 1 })).toBeNull();
  });
});

describe("high-risk permission flags", () => {
  it("marks reject, hide, privacy approval and report resolve as high risk", () => {
    expect(isHighRiskPermission("feature.reject")).toBe(true);
    expect(isHighRiskPermission("comment.hide")).toBe(true);
    expect(isHighRiskPermission("media.privacy_approve")).toBe(true);
    expect(isHighRiskPermission("report.resolve")).toBe(true);
  });

  it("does not mark approve or request-changes as high risk", () => {
    expect(isHighRiskPermission("feature.approve")).toBe(false);
    expect(isHighRiskPermission("feature.request_changes")).toBe(false);
    expect(isHighRiskPermission("comment.approve")).toBe(false);
  });
});

describe("delegationCreateSchema", () => {
  const base = {
    granteeId: "00000000-0000-4000-8000-000000000001",
    permissions: ["feature.approve"],
    categoryKeys: ["bench"],
    region: null,
    validUntil: new Date(Date.now() + 7 * 864e5).toISOString(),
    reason: "汛期专项"
  };

  it("accepts a valid grant", () => {
    expect(delegationCreateSchema.safeParse(base).success).toBe(true);
  });

  it("defaults missing categories and region to unrestricted", () => {
    const parsed = delegationCreateSchema.parse({
      granteeId: base.granteeId,
      permissions: ["feature.approve"],
      validUntil: base.validUntil,
      reason: base.reason
    });
    expect(parsed.categoryKeys).toEqual([]);
    expect(parsed.region).toBeNull();
  });

  it("rejects duplicate permissions", () => {
    expect(
      delegationCreateSchema.safeParse({ ...base, permissions: ["feature.approve", "feature.approve"] }).success
    ).toBe(false);
  });

  it("rejects an empty permission list", () => {
    expect(delegationCreateSchema.safeParse({ ...base, permissions: [] }).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(delegationCreateSchema.safeParse({ ...base, categoryKeys: ["volcano"] }).success).toBe(false);
  });

  it("rejects a short reason", () => {
    expect(delegationCreateSchema.safeParse({ ...base, reason: "x" }).success).toBe(false);
  });
});
