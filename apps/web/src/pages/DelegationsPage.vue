<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { categoryDefinitions, DELEGATION_MAX_HOURS } from "@map/shared/contracts";
import { apiFetch, ApiError } from "../lib/api";

type Delegation = {
  id: string;
  delegate_id: string;
  delegate_name: string;
  delegate_email: string;
  grantor_name: string;
  category_keys: string[];
  region: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null;
  region_name: string | null;
  allow_high_risk: boolean;
  note: string | null;
  status: string;
  effective_status: "active" | "expired" | "revoked";
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
};

type AuditEntry = {
  id: string;
  actor_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const delegations = ref<Delegation[]>([]);
const audit = ref<AuditEntry[]>([]);
const error = ref("");
const notice = ref("");
const submitting = ref(false);

const form = reactive({
  delegateEmail: "",
  categoryKeys: [] as string[],
  useRegion: false,
  regionName: "",
  minLon: "",
  minLat: "",
  maxLon: "",
  maxLat: "",
  allowHighRisk: false,
  expiresInHours: 72,
  note: ""
});

const categories = categoryDefinitions;

const statusLabel: Record<string, string> = {
  active: "生效中",
  expired: "已过期",
  revoked: "已撤销"
};

const actionLabel: Record<string, string> = {
  "delegation.granted": "授予委托",
  "delegation.revoked": "撤销委托",
  "moderation.scope_denied": "越权拒绝",
  "feature.hidden": "隐藏内容",
  "feature.restored": "恢复内容",
  "comment.hidden": "隐藏评论",
  "media.privacy_approved": "媒体隐私确认",
  "report.resolved": "处理举报"
};

function scopeText(item: Delegation): string {
  const categories = item.category_keys.length ? item.category_keys.join("、") : "全部分类";
  const region = item.region_name ?? "不限地区";
  return `${categories} / ${region}`;
}

function auditSummary(entry: AuditEntry): string {
  const meta = entry.metadata ?? {};
  const parts: string[] = [];
  if (typeof meta.delegateEmail === "string") parts.push(`被委托人：${meta.delegateEmail}`);
  if (Array.isArray(meta.categoryKeys)) parts.push(`分类：${meta.categoryKeys.length ? meta.categoryKeys.join("、") : "全部"}`);
  if (typeof meta.regionName === "string" && meta.regionName) parts.push(`地区：${meta.regionName}`);
  if (meta.allowHighRisk === true) parts.push("含高风险");
  if (typeof meta.reason === "string") parts.push(`原因：${meta.reason}`);
  if (typeof meta.attemptedAction === "string") parts.push(`尝试操作：${meta.attemptedAction}`);
  if (typeof meta.categoryKey === "string") parts.push(`目标分类：${meta.categoryKey}`);
  if (typeof meta.reasonCode === "string") parts.push(`原因码：${meta.reasonCode}`);
  return parts.join("；");
}

async function load() {
  try {
    const [delegationRows, auditRows] = await Promise.all([
      apiFetch<Delegation[]>("/admin/delegations"),
      apiFetch<AuditEntry[]>("/admin/delegations/audit")
    ]);
    delegations.value = delegationRows;
    audit.value = auditRows;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "加载委托列表失败";
  }
}

async function submit() {
  error.value = "";
  notice.value = "";
  submitting.value = true;
  try {
    const body: Record<string, unknown> = {
      delegateEmail: form.delegateEmail,
      categoryKeys: form.categoryKeys,
      allowHighRisk: form.allowHighRisk,
      expiresInHours: form.expiresInHours,
      note: form.note || undefined
    };
    if (form.useRegion) {
      body.regionName = form.regionName;
      body.region = {
        minLon: Number(form.minLon),
        minLat: Number(form.minLat),
        maxLon: Number(form.maxLon),
        maxLat: Number(form.maxLat)
      };
    }
    await apiFetch("/admin/delegations", { method: "POST", body });
    notice.value = "委托已授予并通知被委托人。";
    form.delegateEmail = "";
    form.categoryKeys = [];
    form.useRegion = false;
    form.regionName = "";
    form.minLon = form.minLat = form.maxLon = form.maxLat = "";
    form.allowHighRisk = false;
    form.note = "";
    await load();
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : "授予委托失败";
  } finally {
    submitting.value = false;
  }
}

async function revoke(item: Delegation) {
  const reason = window.prompt(`撤销 ${item.delegate_name} 的委托，请填写原因`) ?? "";
  if (reason.trim().length < 2) return;
  error.value = "";
  try {
    await apiFetch(`/admin/delegations/${item.id}/revoke`, { method: "POST", body: { reason: reason.trim() } });
    notice.value = "委托已撤销并通知被委托人。";
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "撤销失败";
  }
}

const canSubmit = computed(() =>
  form.delegateEmail.includes("@")
  && form.expiresInHours >= 1
  && form.expiresInHours <= DELEGATION_MAX_HOURS
  && (!form.useRegion || (form.regionName.trim().length >= 2
    && [form.minLon, form.minLat, form.maxLon, form.maxLat].every((value) => value.trim() !== "" && Number.isFinite(Number(value))))
  )
);

onMounted(load);
</script>

<template>
  <section>
    <div class="page-heading">
      <div>
        <h1>审核权限委托</h1>
        <p>按分类和地区向审核员授予临时审核范围；委托、撤销与高风险操作统一写入审计日志。</p>
      </div>
      <button class="button secondary" type="button" @click="load">刷新</button>
    </div>
    <p v-if="error" class="error-box">{{ error }}</p>
    <p v-if="notice" class="success-box">{{ notice }}</p>

    <div class="card"><form class="card-body" @submit.prevent="submit">
      <h2>授予新委托</h2>
      <div class="field">
        <label for="delegate-email">被委托人邮箱（须为审核员账号）</label>
        <input id="delegate-email" v-model="form.delegateEmail" type="email" required placeholder="moderator@example.com" />
      </div>
      <div class="field">
        <label>分类范围（不勾选表示全部分类）</label>
        <div class="inline">
          <label v-for="category in categories" :key="category.key" class="inline" style="gap:4px">
            <input v-model="form.categoryKeys" type="checkbox" :value="category.key" /> {{ category.name }}
          </label>
        </div>
      </div>
      <div class="field">
        <label class="inline" style="gap:6px">
          <input v-model="form.useRegion" type="checkbox" /> 限定地区（bbox）
        </label>
        <template v-if="form.useRegion">
          <input v-model="form.regionName" placeholder="地区名称，例如：海淀区" style="margin-bottom:8px" />
          <div class="inline">
            <input v-model="form.minLon" inputmode="decimal" placeholder="最小经度" style="width:110px" />
            <input v-model="form.minLat" inputmode="decimal" placeholder="最小纬度" style="width:110px" />
            <input v-model="form.maxLon" inputmode="decimal" placeholder="最大经度" style="width:110px" />
            <input v-model="form.maxLat" inputmode="decimal" placeholder="最大纬度" style="width:110px" />
          </div>
        </template>
      </div>
      <div class="field">
        <label for="expires">有效期（小时，最长 {{ DELEGATION_MAX_HOURS }} 小时 / 30 天）</label>
        <input id="expires" v-model.number="form.expiresInHours" type="number" min="1" :max="DELEGATION_MAX_HOURS" required />
      </div>
      <div class="field">
        <label class="inline" style="gap:6px">
          <input v-model="form.allowHighRisk" type="checkbox" /> 允许高风险操作（隐藏内容、媒体隐私确认）
        </label>
      </div>
      <div class="field">
        <label for="note">备注（可选）</label>
        <input id="note" v-model="form.note" maxlength="500" placeholder="委托背景，例如：节假日值班" />
      </div>
      <button class="button" type="submit" :disabled="submitting || !canSubmit">授予委托</button>
    </form></div>

    <h2>委托列表</h2>
    <div class="card"><div class="card-body" style="overflow-x:auto">
      <table class="table">
        <thead>
          <tr><th>被委托人</th><th>范围</th><th>状态</th><th>有效期至</th><th>授予人</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="item in delegations" :key="item.id">
            <td>
              <strong>{{ item.delegate_name }}</strong><br />
              <span class="muted">{{ item.delegate_email }}</span>
            </td>
            <td>
              {{ scopeText(item) }}
              <span v-if="item.allow_high_risk" class="badge pending">高风险</span>
              <div v-if="item.note" class="muted">{{ item.note }}</div>
              <div v-if="item.revoke_reason" class="muted">撤销原因：{{ item.revoke_reason }}</div>
            </td>
            <td><span class="badge" :class="{ rejected: item.effective_status !== 'active' }">{{ statusLabel[item.effective_status] }}</span></td>
            <td>{{ new Date(item.expires_at).toLocaleString() }}</td>
            <td>{{ item.grantor_name }}</td>
            <td>
              <button v-if="item.effective_status === 'active'" class="button danger small" type="button" @click="revoke(item)">撤销</button>
            </td>
          </tr>
          <tr v-if="!delegations.length"><td colspan="6" class="empty">暂无委托记录。</td></tr>
        </tbody>
      </table>
    </div></div>

    <h2>治理审计（委托 / 撤销 / 越权拒绝 / 高风险操作）</h2>
    <div class="card"><div class="card-body" style="overflow-x:auto">
      <table class="table">
        <thead>
          <tr><th>时间</th><th>操作</th><th>操作者</th><th>详情</th></tr>
        </thead>
        <tbody>
          <tr v-for="entry in audit" :key="entry.id">
            <td>{{ new Date(entry.created_at).toLocaleString() }}</td>
            <td><span class="badge" :class="{ rejected: entry.action === 'moderation.scope_denied' }">{{ actionLabel[entry.action] ?? entry.action }}</span></td>
            <td>{{ entry.actor_name ?? "系统" }}</td>
            <td class="muted">{{ auditSummary(entry) || "—" }}</td>
          </tr>
          <tr v-if="!audit.length"><td colspan="4" class="empty">暂无审计记录。</td></tr>
        </tbody>
      </table>
    </div></div>
  </section>
</template>
