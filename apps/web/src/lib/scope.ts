// 页面层的委托范围判断：与服务端 apps/api/src/delegation.ts 的语义保持一致。
// 服务端仍是最终防线，这里用于在页面上隐藏/禁用越权入口。

export type ScopeRegion = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

export type ScopeDelegation = {
  id: string;
  categoryKeys: string[];
  region: ScopeRegion | null;
  regionName: string | null;
  allowHighRisk: boolean;
  expiresAt: string;
};

export type ModerationScope = {
  role: string;
  unrestricted: boolean;
  canApproveMedia: boolean;
  delegations: ScopeDelegation[];
};

export type ScopeItem = {
  categoryKey: string;
  longitude?: number | null;
  latitude?: number | null;
};

export function delegationMatches(
  delegation: Pick<ScopeDelegation, "categoryKeys" | "region" | "allowHighRisk">,
  item: ScopeItem,
  options: { highRisk?: boolean } = {}
): boolean {
  if (options.highRisk && !delegation.allowHighRisk) return false;
  if (delegation.categoryKeys.length > 0 && !delegation.categoryKeys.includes(item.categoryKey)) return false;
  if (delegation.region && item.longitude != null && item.latitude != null) {
    const { minLon, minLat, maxLon, maxLat } = delegation.region;
    if (item.longitude < minLon || item.longitude > maxLon) return false;
    if (item.latitude < minLat || item.latitude > maxLat) return false;
  }
  return true;
}

/** 页面上某个内容项是否可执行指定操作；高风险操作要求委托带 allowHighRisk。 */
export function canModerateItem(
  scope: ModerationScope | null,
  item: ScopeItem,
  options: { highRisk?: boolean } = {}
): boolean {
  if (!scope) return false;
  if (scope.unrestricted) return true;
  return scope.delegations.some((delegation) => delegationMatches(delegation, item, options));
}

export function scopeSummary(scope: ModerationScope | null): string {
  if (!scope) return "";
  if (scope.unrestricted) return "管理员：不受委托范围限制。";
  if (!scope.delegations.length) return "当前没有有效的审核委托，队列不可操作。请联系管理员授予。";
  return scope.delegations
    .map((delegation) => {
      const categories = delegation.categoryKeys.length ? delegation.categoryKeys.join("、") : "全部分类";
      const region = delegation.regionName ?? "不限地区";
      const risk = delegation.allowHighRisk ? "，含高风险" : "";
      const expires = new Date(delegation.expiresAt).toLocaleString();
      return `${categories} / ${region}${risk}，至 ${expires}`;
    })
    .join("；");
}
