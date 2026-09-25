import { z } from "zod";

export const USER_ROLES = ["contributor", "moderator", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = [
  "pending_verification",
  "active",
  "suspended",
  "deletion_pending",
  "deleted"
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const CONTENT_STATUSES = [
  "draft",
  "pending",
  "published",
  "rejected",
  "changes_requested",
  "hidden",
  "deleted"
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const COMMENT_STATUSES = ["pending", "published", "rejected", "hidden", "deleted"] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const MEDIA_STATUSES = [
  "quarantined",
  "scanning",
  "processing",
  "manual_review",
  "ready",
  "rejected",
  "failed",
  "deleted"
] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const CONDITION_VALUES = ["good", "fair", "poor", "unknown"] as const;
export const categoryKeys = [
  "bench",
  "drinking_water",
  "rain_shelter",
  "quiet_corner",
  "night_lighting"
] as const;
export type CategoryKey = (typeof categoryKeys)[number];

const optionalBoolean = z.boolean().nullable().optional();
const optionalText = z.string().trim().max(160).nullable().optional();

export const benchDetailsSchema = z.object({
  seatCount: z.number().int().min(1).max(100).nullable().optional(),
  hasBackrest: optionalBoolean,
  covered: optionalBoolean,
  shaded: optionalBoolean,
  hasArmrests: optionalBoolean,
  wheelchairSpace: optionalBoolean,
  material: optionalText,
  damageNotes: optionalText
}).strict();

export const drinkingWaterDetailsSchema = z.object({
  potable: z.enum(["yes", "no", "unknown"]).default("unknown"),
  waterType: z.enum(["fountain", "bottle_filler", "tap", "unknown"]).default("unknown"),
  bottleFiller: optionalBoolean,
  working: z.enum(["yes", "no", "unknown"]).default("unknown"),
  seasonal: optionalBoolean,
  pressure: z.enum(["low", "normal", "high", "unknown"]).default("unknown")
}).strict();

export const rainShelterDetailsSchema = z.object({
  capacity: z.number().int().min(1).max(500).nullable().optional(),
  windProtection: z.enum(["none", "partial", "strong", "unknown"]).default("unknown"),
  seating: optionalBoolean,
  flooding: z.enum(["yes", "no", "unknown"]).default("unknown"),
  structureNotes: optionalText
}).strict();

export const quietCornerDetailsSchema = z.object({
  seating: optionalBoolean,
  powerOutlet: optionalBoolean,
  wifi: optionalBoolean,
  crowdLevel: z.enum(["empty", "low", "medium", "high", "unknown"]).default("unknown"),
  bestTimes: z.string().trim().max(240).nullable().optional(),
  suitableFor: z.string().trim().max(240).nullable().optional()
}).strict();

export const nightLightingDetailsSchema = z.object({
  brightness: z.number().int().min(1).max(5).nullable().optional(),
  coverage: z.enum(["tiny", "partial", "wide", "unknown"]).default("unknown"),
  colorTemperature: z.enum(["warm", "neutral", "cold", "unknown"]).default("unknown"),
  lightType: z.string().trim().max(80).nullable().optional(),
  operatingHours: z.string().trim().max(120).nullable().optional(),
  brokenLights: z.number().int().min(0).max(100).nullable().optional(),
  safetyFeeling: z.number().int().min(1).max(5).nullable().optional()
}).strict();

export const detailSchemas = {
  bench: benchDetailsSchema,
  drinking_water: drinkingWaterDetailsSchema,
  rain_shelter: rainShelterDetailsSchema,
  quiet_corner: quietCornerDetailsSchema,
  night_lighting: nightLightingDetailsSchema
} satisfies Record<CategoryKey, z.ZodTypeAny>;

export const privacyRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1)
}).refine((value) => value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001, {
  message: "Privacy region must stay within the image"
});

export const featurePayloadSchema = z.object({
  categoryKey: z.enum(categoryKeys),
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(2000),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  locationAccuracyM: z.number().int().min(3).max(100),
  observedAt: z.coerce.date(),
  condition: z.enum(CONDITION_VALUES),
  stepFree: optionalBoolean,
  wheelchairAccessible: optionalBoolean,
  noiseLevel: z.number().int().min(1).max(5).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
  details: z.record(z.string(), z.unknown()).default({}),
  mediaIds: z.array(z.string().uuid()).max(6).default([])
}).superRefine((value, context) => {
  if (new Set(value.mediaIds).size !== value.mediaIds.length) {
    context.addIssue({
      code: "custom",
      path: ["mediaIds"],
      message: "Media IDs must be unique"
    });
  }
  const parsed = detailSchemas[value.categoryKey].safeParse(value.details);
  if (!parsed.success) {
    context.addIssue({
      code: "custom",
      path: ["details"],
      message: `Invalid details for ${value.categoryKey}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`
    });
  }
});

export const createFeatureSchema = featurePayloadSchema;

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  parentId: z.string().uuid().nullable().optional()
});

export const updateCommentSchema = z.object({
  body: z.string().trim().min(1).max(1000)
});

export const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
  displayName: z.string().trim().min(2).max(40)
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128)
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(254)
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(300),
  password: z.string().min(10).max(128)
});

export const verifyEmailSchema = z.object({
  token: z.string().min(20).max(300)
});

export const mediaUploadInitSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().positive()
});

export const mediaUploadCompleteSchema = z.object({
  privacyRegions: z.array(privacyRegionSchema).max(50).default([]),
  containsPeopleOrPlates: z.boolean().default(false),
  rightsConfirmed: z.literal(true)
});

export const moderationDecisionSchema = z.object({
  reasonCode: z.string().trim().min(2).max(64),
  notes: z.string().trim().max(1000).optional()
});

/* ============================================================
   审核权限委托（Delegation）
   管理员按分类与地区，把部分审核动作临时委托给审核员。
   纯判断函数同时被 API（服务端强制）与 Web（页面层隐藏）复用。
   ============================================================ */

export const MODERATION_PERMISSIONS = [
  "feature.approve",
  "feature.reject",
  "feature.request_changes",
  "feature.hide",
  "comment.approve",
  "comment.reject",
  "comment.hide",
  "media.privacy_approve",
  "report.resolve"
] as const;
export type ModerationPermission = (typeof MODERATION_PERMISSIONS)[number];

// 拒绝、隐藏、举报处理与媒体隐私确认属于高风险动作，与委托/撤销一并进入审计。
export const HIGH_RISK_PERMISSIONS = [
  "feature.reject",
  "feature.hide",
  "comment.reject",
  "comment.hide",
  "media.privacy_approve",
  "report.resolve"
] as const satisfies readonly ModerationPermission[];

export function isHighRiskPermission(permission: ModerationPermission): boolean {
  return (HIGH_RISK_PERMISSIONS as readonly string[]).includes(permission);
}

export const MODERATION_PERMISSION_LABELS = {
  "feature.approve": "批准地点内容",
  "feature.reject": "拒绝地点内容",
  "feature.request_changes": "要求修改",
  "feature.hide": "隐藏地点内容",
  "comment.approve": "批准评论",
  "comment.reject": "拒绝评论",
  "comment.hide": "隐藏评论",
  "media.privacy_approve": "确认媒体隐私并发布",
  "report.resolve": "处理举报"
} as const satisfies Record<ModerationPermission, string>;

export type LngLat = readonly [number, number];
export type LngLatBBox = readonly [number, number, number, number];

export type BBoxRegion = { type: "bbox"; bbox: LngLatBBox };
export type PolygonRegion = { type: "Polygon"; coordinates: LngLat[][] };
export type DelegationRegion = BBoxRegion | PolygonRegion;

// 一次委托的有效范围：权限集合 × 分类集合（空=全部分类） × 地理区域（null=不限地区）。
export type DelegationScope = {
  permissions: ModerationPermission[];
  categoryKeys: string[];
  region: DelegationRegion | null;
};

const pointPositionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90)
]);

const linearRingSchema = z
  .array(pointPositionSchema)
  .min(4, "Polygon rings need at least four positions")
  .refine(
    (ring) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      return Boolean(first && last && first[0] === last[0] && first[1] === last[1]);
    },
    { message: "Polygon rings must be closed" }
  );

const bboxRegionSchema = z
  .object({
    type: z.literal("bbox"),
    bbox: z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
      z.number().min(-180).max(180),
      z.number().min(-90).max(90)
    ])
  })
  .strict()
  .refine((value) => value.bbox[0] < value.bbox[2] && value.bbox[1] < value.bbox[3], {
    message: "bbox minimum longitude/latitude must be smaller than maximum"
  });

const polygonRegionSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(linearRingSchema).min(1, "Polygon needs at least one ring")
  })
  .strict();

export const delegationRegionSchema = z.discriminatedUnion("type", [bboxRegionSchema, polygonRegionSchema]);

export const delegationCreateSchema = z
  .object({
    granteeId: z.string().uuid(),
    permissions: z.array(z.enum(MODERATION_PERMISSIONS)).min(1).max(20),
    categoryKeys: z.array(z.enum(categoryKeys)).max(categoryKeys.length).default([]),
    region: delegationRegionSchema.nullable().default(null),
    validUntil: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(2).max(500)
  })
  .superRefine((value, context) => {
    if (new Set(value.permissions).size !== value.permissions.length) {
      context.addIssue({ code: "custom", path: ["permissions"], message: "Permissions must be unique" });
    }
    if (new Set(value.categoryKeys).size !== value.categoryKeys.length) {
      context.addIssue({ code: "custom", path: ["categoryKeys"], message: "Category keys must be unique" });
    }
  });

export const delegationRevokeSchema = z.object({
  reason: z.string().trim().min(2).max(300)
});

export function pointInBBox(lon: number, lat: number, bbox: LngLatBBox): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

// 射线法判断点是否在线性环内；外环在内、洞环在外。
export function pointInRing(lon: number, lat: number, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const vi = ring[i];
    const vj = ring[j];
    if (!vi || !vj) continue;
    const [xi, yi] = vi;
    const [xj, yj] = vj;
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(lon: number, lat: number, rings: readonly LngLat[][]): boolean {
  const outer = rings[0];
  if (!outer || !pointInRing(lon, lat, outer)) return false;
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i];
    if (hole && pointInRing(lon, lat, hole)) return false;
  }
  return true;
}

export function pointInRegion(lon: number, lat: number, region: DelegationRegion): boolean {
  if (region.type === "bbox") return pointInBBox(lon, lat, region.bbox);
  return pointInPolygon(lon, lat, region.coordinates);
}

// 供 PostGIS ST_GeomFromGeoJSON 使用：bbox 也规范化成闭合 Polygon。
export function regionToPolygonGeoJson(region: DelegationRegion): PolygonRegion {
  if (region.type === "Polygon") return { type: "Polygon", coordinates: region.coordinates };
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return {
    type: "Polygon",
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat]
      ]
    ]
  };
}

export type ScopeTarget = {
  categoryKey?: string | null;
  longitude?: number | null;
  latitude?: number | null;
};

export function scopeAllows(scope: DelegationScope, permission: ModerationPermission, target: ScopeTarget): boolean {
  if (!scope.permissions.includes(permission)) return false;
  if (scope.categoryKeys.length > 0) {
    if (!target.categoryKey || !scope.categoryKeys.includes(target.categoryKey)) return false;
  }
  if (scope.region) {
    if (typeof target.longitude !== "number" || typeof target.latitude !== "number") return false;
    if (!pointInRegion(target.longitude, target.latitude, scope.region)) return false;
  }
  return true;
}

// 返回第一条允许该动作的委托范围；没有则返回 null（调用方据此拒绝越权）。
export function scopesAllow(
  scopes: readonly DelegationScope[],
  permission: ModerationPermission,
  target: ScopeTarget
): DelegationScope | null {
  for (const scope of scopes) {
    if (scopeAllows(scope, permission, target)) return scope;
  }
  return null;
}

export const reportCreateSchema = z.object({
  targetType: z.enum(["feature", "comment"]),
  targetId: z.string().uuid(),
  reasonCode: z.string().trim().min(2).max(64),
  notes: z.string().trim().max(1000).optional()
});

export const confirmationSchema = z.object({
  result: z.enum(["still_accurate", "changed", "closed"]),
  note: z.string().trim().max(500).optional()
});

export const categoryDefinitions = [
  {
    key: "bench",
    name: "长椅",
    icon: "bench",
    sortOrder: 10,
    detailSchema: {
      seatCount: "number|null",
      hasBackrest: "boolean|null",
      covered: "boolean|null",
      shaded: "boolean|null",
      hasArmrests: "boolean|null",
      wheelchairSpace: "boolean|null",
      material: "string|null",
      damageNotes: "string|null"
    }
  },
  {
    key: "drinking_water",
    name: "饮水处",
    icon: "water",
    sortOrder: 20,
    detailSchema: {
      potable: "yes|no|unknown",
      waterType: "fountain|bottle_filler|tap|unknown",
      bottleFiller: "boolean|null",
      working: "yes|no|unknown",
      seasonal: "boolean|null",
      pressure: "low|normal|high|unknown"
    }
  },
  {
    key: "rain_shelter",
    name: "遮雨棚",
    icon: "shelter",
    sortOrder: 30,
    detailSchema: {
      capacity: "number|null",
      windProtection: "none|partial|strong|unknown",
      seating: "boolean|null",
      flooding: "yes|no|unknown",
      structureNotes: "string|null"
    }
  },
  {
    key: "quiet_corner",
    name: "安静角落",
    icon: "quiet",
    sortOrder: 40,
    detailSchema: {
      seating: "boolean|null",
      powerOutlet: "boolean|null",
      wifi: "boolean|null",
      crowdLevel: "empty|low|medium|high|unknown",
      bestTimes: "string|null",
      suitableFor: "string|null"
    }
  },
  {
    key: "night_lighting",
    name: "夜间照明",
    icon: "light",
    sortOrder: 50,
    detailSchema: {
      brightness: "number|null",
      coverage: "tiny|partial|wide|unknown",
      colorTemperature: "warm|neutral|cold|unknown",
      lightType: "string|null",
      operatingHours: "string|null",
      brokenLights: "number|null",
      safetyFeeling: "number|null"
    }
  }
] as const;

export type FeaturePayload = z.infer<typeof featurePayloadSchema>;
export type PrivacyRegion = z.infer<typeof privacyRegionSchema>;

export function categoryName(key: CategoryKey): string {
  return categoryDefinitions.find((item) => item.key === key)?.name ?? key;
}
