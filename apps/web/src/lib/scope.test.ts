import { describe, expect, it } from "vitest";
import { canModerateItem, delegationMatches, scopeSummary, type ModerationScope } from "./scope";

const delegation = {
  id: "d1",
  categoryKeys: ["bench"],
  region: { minLon: 116.2, minLat: 39.9, maxLon: 116.4, maxLat: 40.05 },
  regionName: "海淀区",
  allowHighRisk: false,
  expiresAt: new Date(Date.now() + 3600_000).toISOString()
};

const moderatorScope: ModerationScope = {
  role: "moderator",
  unrestricted: false,
  canApproveMedia: false,
  delegations: [delegation]
};

const adminScope: ModerationScope = {
  role: "admin",
  unrestricted: true,
  canApproveMedia: true,
  delegations: []
};

describe("canModerateItem（页面层越权拒绝）", () => {
  it("allows items inside the delegated category and region", () => {
    expect(canModerateItem(moderatorScope, { categoryKey: "bench", longitude: 116.3, latitude: 39.98 })).toBe(true);
  });

  it("rejects items outside the delegated category or region", () => {
    expect(canModerateItem(moderatorScope, { categoryKey: "drinking_water", longitude: 116.3, latitude: 39.98 })).toBe(false);
    expect(canModerateItem(moderatorScope, { categoryKey: "bench", longitude: 117.0, latitude: 39.98 })).toBe(false);
  });

  it("rejects high-risk actions without a high-risk delegation", () => {
    const item = { categoryKey: "bench", longitude: 116.3, latitude: 39.98 };
    expect(canModerateItem(moderatorScope, item, { highRisk: true })).toBe(false);
    const highRiskScope: ModerationScope = {
      ...moderatorScope,
      delegations: [{ ...delegation, allowHighRisk: true }]
    };
    expect(canModerateItem(highRiskScope, item, { highRisk: true })).toBe(true);
  });

  it("admins are unrestricted, and an empty scope rejects everything", () => {
    expect(canModerateItem(adminScope, { categoryKey: "bench", longitude: 0, latitude: 0 }, { highRisk: true })).toBe(true);
    expect(canModerateItem(null, { categoryKey: "bench" })).toBe(false);
    expect(canModerateItem({ ...moderatorScope, delegations: [] }, { categoryKey: "bench" })).toBe(false);
  });
});

describe("delegationMatches", () => {
  it("treats missing coordinates as region-neutral on the page", () => {
    expect(delegationMatches(delegation, { categoryKey: "bench" })).toBe(true);
  });
});

describe("scopeSummary", () => {
  it("describes empty and unrestricted scopes", () => {
    expect(scopeSummary(adminScope)).toContain("不受委托范围限制");
    expect(scopeSummary({ ...moderatorScope, delegations: [] })).toContain("没有有效的审核委托");
    expect(scopeSummary(moderatorScope)).toContain("海淀区");
  });
});
