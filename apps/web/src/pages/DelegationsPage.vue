<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import {
  categoryName,
  categoryKeys,
  isHighRiskPermission,
  MODERATION_PERMISSIONS,
  MODERATION_PERMISSION_LABELS,
  type CategoryKey,
  type DelegationRegion,
  type ModerationPermission
} from "@map/shared/contracts";
import { apiFetch } from "../lib/api";

type Moderator = { id: string; email: string; display_name: string; status: string };
type Delegation = {
  id: string;
  granteeId: string;
  granteeName?: string;
  granteeEmail?: string;
  permissions: ModerationPermission[];
  categoryKeys: string[];
  region: DelegationRegion | null;
  reason: string;
  validUntil: string;
  status: "active" | "revoked" | "expired";
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
};
type AuditRow = {
  id: string;
  actor_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: { highRisk?: boolean; delegationId?: string; reason?: string; granteeId?: string };
  created_at: string;
};

const moderators = ref<Moderator[]>([]);
const delegations = ref<Delegation[]>([]);
const auditRows = ref<AuditRow[]>([]);
const error = ref("");
const notice = ref("");
const tab = ref<"create" | "list" | "audit">("create");

const form = reactive({
  granteeId: "",
  permissions: new Set<ModerationPermission>(["feature.approve"]),
  categoryKeys: new Set<string>(),
  regionMode: "none" as "none" | "bbox" | "polygon",
  bbox: { minLon: "116.30", minLat: "39.80", maxLon: "116.50", maxLat: "40.00" },
  polygonText: "",
  validDays: "7",
  reason: ""
});

function togglePermission(permission: ModerationPermission, checked: boolean) {
  if (checked) form.permissions.add(permission);
  else form.permissions.delete(permission);
}

function toggleCategory(key: string, checked: boolean) {
  if (checked) form.categoryKeys.add(key);
  else form.categoryKeys.delete(key);
}

function buildRegion(): DelegationRegion | null {
  if (form.regionMode === "none") return null;
  if (form.regionMode === "bbox") {
    const bbox = [
      Number(form.bbox.minLon),
      Number(form.bbox.minLat),
      Number(form.bbox.maxLon),
      Number(form.bbox.maxLat)
    ] as const;
    if (bbox.some((value) => !Number.isFinite(value))) {
      throw new Error("地区经纬度必须是数字");
    }
    return { type: "bbox", bbox };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(form.polygonText);
  } catch {
    throw new Error("多边形 GeoJSON 不是合法 JSON");
  }
  return parsed as DelegationRegion;
}

async function submit() {
  error.value = "";
  notice.value = "";
  if (!form.granteeId) {
    error.value = "请选择被授予的审核员";
    return;
  }
  if (form.permissions.size === 0) {
    error.value = "至少选择一个审核动作";
    return;
  }
  if (form.reason.trim().length < 2) {
    error.value = "请填写委托理由（至少 2 个字符，会写入审计）";
    return;
  }
  try {
    const region = buildRegion();
    const days = Number(form.validDays);
    if (!Number.isFinite(days) || days <= 0 || days > 30) {
      throw new Error("有效期必须在 1 到 30 天之间");
    }
    const validUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await apiFetch("/admin/delegations", {
      method: "POST",
      body: {
        granteeId: form.granteeId,
        permissions: [...form.permissions],
        categoryKeys: [...form.categoryKeys],
        region,
        validUntil: validUntil.toISOString(),
        reason: form.reason.trim()
      }
    });
    notice.value = "临时审核范围已授予，并写入审计日志。";
    form.reason = "";
    await loadDelegations();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "授予失败";
  }
}

async function revoke(item: Delegation) {
  const reason = window.prompt("撤销原因（必填，会写入审计）") ?? "";
  if (reason.trim().length < 2) return;
  try {
    await apiFetch(`/admin/delegations/${item.id}`, { method: "DELETE", body: { reason: reason.trim() } });
    notice.value = "委托已撤销。";
    await loadDelegations();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "撤销失败";
  }
}

async function loadModerators() {
  moderators.value = await apiFetch<Moderator[]>("/admin/moderators");
}

async function loadDelegations() {
  const result = await apiFetch<{ delegations: Delegation[] }>("/admin/delegations?status=all");
  delegations.value = result.delegations;
}

async function loadAudit() {
  const rows = await apiFetch<AuditRow[]>("/moderation/audit?limit=200&delegationOnly=true");
  auditRows.value = rows;
}

function regionDescription(region: DelegationRegion | null): string {
  if (!region) return "不限地区";
  if (region.type === "bbox") {
    const [minLon, minLat, maxLon, maxLat] = region.bbox;
    return `矩形 ${minLon},${minLat} → ${maxLon},${maxLat}`;
  }
  return `多边形（${region.coordinates[0]?.length ?? 0} 个外环点）`;
}

function categoryDescription(keys: string[]): string {
  return keys.length ? keys.map((key) => categoryName(key as CategoryKey)).join("、") : "全部分类";
}

onMounted(async () => {
  try {
    await Promise.all([loadModerators(), loadDelegations()]);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "加载失败";
  }
});
</script>

<template>
  <section>
    <div class="page-heading">
      <div>
        <h1>审核权限委托</h1>
        <p>按分类和地区向审核员授予临时审核范围；委托、撤销与高风险审核动作统一进入审计。</p>
      </div>
    </div>

    <p v-if="error" class="error-box">{{ error }}</p>
    <p v-if="notice" class="success-box">{{ notice }}</p>

    <div class="pill-tabs">
      <button :class="{ active: tab === 'create' }" @click="tab = 'create'">授予委托</button>
      <button :class="{ active: tab === 'list' }" @click="loadDelegations(); tab = 'list'">委托记录</button>
      <button :class="{ active: tab === 'audit' }" @click="loadAudit(); tab = 'audit'">委托与高风险审计</button>
    </div>

    <div v-if="tab === 'create'" class="card"><div class="card-body">
      <form @submit.prevent="submit">
        <p>
          <label for="grantee">被授予审核员</label><br />
          <select id="grantee" v-model="form.granteeId" style="min-width: 280px">
            <option value="" disabled>请选择…</option>
            <option v-for="moderator in moderators" :key="moderator.id" :value="moderator.id">
              {{ moderator.display_name }}（{{ moderator.email }}）
            </option>
          </select>
        </p>

        <fieldset>
          <legend>审核动作（高风险动作会额外标记到审计）</legend>
          <label v-for="permission in MODERATION_PERMISSIONS" :key="permission" class="inline" style="display:inline-flex; gap:6px; margin:4px 14px 4px 0">
            <input
              type="checkbox"
              :checked="form.permissions.has(permission)"
              @change="togglePermission(permission, ($event.target as HTMLInputElement).checked)"
            />
            {{ MODERATION_PERMISSION_LABELS[permission] }}
            <span v-if="isHighRiskPermission(permission)" class="badge rejected">高风险</span>
          </label>
        </fieldset>

        <fieldset>
          <legend>分类范围（不勾选 = 全部分类）</legend>
          <label v-for="key in categoryKeys" :key="key" class="inline" style="display:inline-flex; gap:6px; margin:4px 14px 4px 0">
            <input
              type="checkbox"
              :checked="form.categoryKeys.has(key)"
              @change="toggleCategory(key, ($event.target as HTMLInputElement).checked)"
            />
            {{ categoryName(key) }}
          </label>
        </fieldset>

        <fieldset>
          <legend>地区范围</legend>
          <label style="margin-right:16px"><input type="radio" value="none" v-model="form.regionMode" /> 不限地区</label>
          <label style="margin-right:16px"><input type="radio" value="bbox" v-model="form.regionMode" /> 矩形（西/南/东/北）</label>
          <label><input type="radio" value="polygon" v-model="form.regionMode" /> 自定义多边形 GeoJSON</label>

          <div v-if="form.regionMode === 'bbox'" class="inline" style="margin-top:8px; flex-wrap:wrap; gap:8px">
            <input v-model="form.bbox.minLon" placeholder="最小经度" style="width:120px" />
            <input v-model="form.bbox.minLat" placeholder="最小纬度" style="width:120px" />
            <input v-model="form.bbox.maxLon" placeholder="最大经度" style="width:120px" />
            <input v-model="form.bbox.maxLat" placeholder="最大纬度" style="width:120px" />
          </div>
          <p v-if="form.regionMode === 'polygon'" style="margin-top:8px">
            <textarea
              v-model="form.polygonText"
              rows="6"
              style="width:100%"
              placeholder='{"type":"Polygon","coordinates":[[[116.3,39.8],[116.5,39.8],[116.5,40.0],[116.3,40.0],[116.3,39.8]]]}'
            ></textarea>
          </p>
        </fieldset>

        <p>
          <label for="validDays">有效期（天，最长 30 天）</label><br />
          <input id="validDays" v-model="form.validDays" type="number" min="1" max="30" style="width:120px" />
        </p>
        <p>
          <label for="reason">委托理由（写入审计）</label><br />
          <textarea id="reason" v-model="form.reason" rows="2" maxlength="500" style="width:100%" placeholder="例如：汛期专项，负责本市范围内饮水处审核两周"></textarea>
        </p>
        <button class="button" type="submit">授予临时范围</button>
      </form>
    </div></div>

    <div v-if="tab === 'list'" class="moderation-grid">
      <article v-for="item in delegations" :key="item.id" class="card"><div class="card-body">
        <div class="inline">
          <strong>{{ item.granteeName }}</strong>
          <span class="badge" :class="item.status">{{ item.status === 'active' ? '生效中' : item.status === 'revoked' ? '已撤销' : '已过期' }}</span>
        </div>
        <p class="muted">{{ item.granteeEmail }}</p>
        <p>{{ item.permissions.map((permission) => MODERATION_PERMISSION_LABELS[permission]).join("、") }}</p>
        <p class="muted">{{ categoryDescription(item.categoryKeys) }} · {{ regionDescription(item.region) }}</p>
        <p class="muted">理由：{{ item.reason }}</p>
        <p class="muted">
          生效至 {{ new Date(item.validUntil).toLocaleString() }}
          <template v-if="item.revokedAt"> · 撤销于 {{ new Date(item.revokedAt).toLocaleString() }}：{{ item.revokeReason }}</template>
        </p>
        <button v-if="item.status === 'active'" class="button danger small" @click="revoke(item)">撤销委托</button>
      </div></article>
      <div v-if="!delegations.length" class="card empty">还没有委托记录。</div>
    </div>

    <div v-if="tab === 'audit'" class="card"><div class="card-body">
      <p class="muted">包含委托授予/撤销，以及在委托下执行的高风险审核动作（拒绝、隐藏、隐私确认、举报处理）。</p>
      <table style="width:100%; border-collapse:collapse; font-size:14px">
        <thead>
          <tr style="text-align:left">
            <th style="padding:6px">时间</th>
            <th style="padding:6px">操作者</th>
            <th style="padding:6px">动作</th>
            <th style="padding:6px">资源</th>
            <th style="padding:6px">标记</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in auditRows" :key="row.id" style="border-top:1px solid var(--line)">
            <td style="padding:6px; white-space:nowrap">{{ new Date(row.created_at).toLocaleString() }}</td>
            <td style="padding:6px">{{ row.actor_name ?? row.metadata.granteeId ?? "系统" }}</td>
            <td style="padding:6px">{{ row.action }}</td>
            <td style="padding:6px" class="muted">{{ row.resource_type }}{{ row.resource_id ? `:${row.resource_id.slice(0, 8)}` : "" }}</td>
            <td style="padding:6px">
              <span v-if="row.metadata?.highRisk" class="badge rejected">高风险</span>
              <span v-if="row.metadata?.delegationId" class="badge">委托 {{ row.metadata.delegationId.slice(0, 8) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!auditRows.length" class="empty">暂无相关审计记录。</div>
    </div></div>
  </section>
</template>
