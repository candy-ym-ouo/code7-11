import { describe, expect, it } from "vitest";
import {
  DELEGATION_MAX_HOURS,
  delegationCreateSchema,
  delegationRegionSchema,
  delegationRevokeSchema,
  featurePayloadSchema,
  privacyRegionSchema
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

describe("delegationCreateSchema", () => {
  const base = {
    delegateEmail: "mod@example.com",
    categoryKeys: ["bench"],
    allowHighRisk: false,
    expiresInHours: 72
  };

  it("accepts a scoped temporary delegation", () => {
    const result = delegationCreateSchema.safeParse({
      ...base,
      region: { minLon: 116.2, minLat: 39.9, maxLon: 116.4, maxLat: 40.05 },
      regionName: "海淀区"
    });
    expect(result.success).toBe(true);
  });

  it("requires a region name when a region is set", () => {
    const result = delegationCreateSchema.safeParse({
      ...base,
      region: { minLon: 116.2, minLat: 39.9, maxLon: 116.4, maxLat: 40.05 }
    });
    expect(result.success).toBe(false);
  });

  it("enforces the temporary window and rejects unknown categories", () => {
    expect(delegationCreateSchema.safeParse({ ...base, expiresInHours: DELEGATION_MAX_HOURS + 1 }).success).toBe(false);
    expect(delegationCreateSchema.safeParse({ ...base, expiresInHours: 0 }).success).toBe(false);
    expect(delegationCreateSchema.safeParse({ ...base, categoryKeys: ["not_a_category"] }).success).toBe(false);
    expect(delegationCreateSchema.safeParse({ ...base, categoryKeys: ["bench", "bench"] }).success).toBe(false);
  });

  it("rejects inverted region bounds", () => {
    expect(delegationRegionSchema.safeParse({ minLon: 116.4, minLat: 39.9, maxLon: 116.2, maxLat: 40.05 }).success).toBe(false);
    expect(delegationRegionSchema.safeParse({ minLon: 116.2, minLat: 39.9, maxLon: 116.4, maxLat: 40.05 }).success).toBe(true);
  });
});

describe("delegationRevokeSchema", () => {
  it("requires a reason", () => {
    expect(delegationRevokeSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(delegationRevokeSchema.safeParse({ reason: "值班结束" }).success).toBe(true);
  });
});
