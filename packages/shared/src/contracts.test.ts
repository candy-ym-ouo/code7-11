import { describe, expect, it } from "vitest";
import { featurePayloadSchema, privacyRegionSchema } from "./contracts";

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
