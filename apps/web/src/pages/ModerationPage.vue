<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  MODERATION_PERMISSION_LABELS,
  scopeAllows,
  type DelegationScope,
  type ModerationPermission
} from "@map/shared/contracts";
import { apiFetch } from "../lib/api";
import { useAuthStore } from "../stores/auth";

type FeatureItem = {
  revision_id: string;
  feature_id: string;
  revision_no: number;
  payload: { title: string; description: string; categoryKey: string; mediaIds?: string[] };
  submitted_at: string;
  feature_status: string;
  author_name: string;
  category_key: string | null;
  longitude: number | null;
  latitude: number | null;
};
type CommentItem = {
  id: string;
  feature_id: string;
  body: string;
  created_at: string;
  author_name: string;
  category_key: string | null;
  longitude: number | null;
  latitude: number | null;
};
type MediaItem = {
  id: string;
  original_filename: string;
  privacy_status: string;
  privacy_report: { manualRegions?: unknown[]; detectorConfigured?: boolean };
  processed_object_key: string | null;
  created_at: string;
  owner_name: string;
  category_key: string | null;
  longitude: number | null;
  latitude: number | null;
};
type ReportItem = {
  id: string;
  target_type: "feature" | "comment";
  target_id: string;
  reason_code: string;
  notes: string | null;
  created_at: string;
  reporter_name: string;
  category_key: string | null;
  longitude: number | null;
  latitude: number | null;
};
type Queue = {
  counts: { features: number; comments: number; media: number; reports: number };
  features: FeatureItem[];
  comments: CommentItem[];
  media: MediaItem[];
  reports: ReportItem[];
};
type DelegationDto = {
  id: string;
  permissions: ModerationPermission[];
  categoryKeys: string[];
  region: DelegationScope["region"];
  reason: string;
  validUntil: string;
};

const auth = useAuthStore();
const isAdmin = computed(() => auth.isAdmin);

const queue = ref<Queue>({ counts: { features: 0, comments: 0, media: 0, reports: 0 }, features: [], comments: [], media: [], reports: [] });
const scopes = ref<DelegationScope[]>([]);
const error = ref("");
const notice = ref("");
const active = ref<"features" | "comments" | "media" | "reports">("features");
const previews = reactive<Record<string, string>>({});

// 页面层只是隐藏/禁用入口；真正的越权拒绝由 API 服务端执行（纵深防御）。
function can(
  permission: ModerationPermission,
  target: { category_key: string | null; longitude: number | null; latitude: number | null }
): boolean {
  if (isAdmin.value) return true;
  return scopes.value.some((scope) =>
    scopeAllows(scope, permission, {
      categoryKey: target.category_key,
      longitude: target.longitude,
      latitude: target.latitude
    })
  );
}

async function load() {
  error.value = "";
  try {
    queue.value = await apiFetch<Queue>("/moderation/queue");
    if (!isAdmin.value) {
      const mine = await apiFetch<{ scopes: DelegationDto[] }>("/moderation/my-scope");
      scopes.value = mine.scopes.map((item) => ({
        permissions: item.permissions,
        categoryKeys: item.categoryKeys,
        region: item.region
      }));
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "加载审核队列失败";
  }
}

function decision() {
  const reasonCode = window.prompt("原因码，例如 INCOMPLETE_INFO、WRONG_LOCATION、PERSONAL_INFORMATION、SPAM") ?? "";
  const notes = window.prompt("审核备注（可选）") ?? undefined;
  return { reasonCode, notes };
}

async function featureAction(item: FeatureItem, action: "approve" | "reject" | "request-changes" | "hide") {
  try {
    const body = action === "approve" ? undefined : decision();
    if (action !== "approve" && !body?.reasonCode) return;
    await apiFetch(`/moderation/features/${item.feature_id}/${action}`, { method: "POST", body });
    notice.value = "审核动作已完成。";
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "审核失败";
  }
}

async function commentAction(item: CommentItem, action: "approve" | "reject" | "hide") {
  try {
    const body = action === "approve" ? undefined : decision();
    if (action !== "approve" && !body?.reasonCode) return;
    await apiFetch(`/moderation/comments/${item.id}/${action}`, { method: "POST", body });
    notice.value = "评论审核完成。";
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "评论审核失败";
  }
}

async function loadPreview(item: MediaItem) {
  try {
    const result = await apiFetch<{ url: string }>(`/media/${item.id}/preview`);
    previews[item.id] = result.url;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "无法生成预览";
  }
}

async function approveMedia(item: MediaItem) {
  try {
    await apiFetch(`/media/${item.id}/privacy-approve`, { method: "POST" });
    notice.value = "媒体隐私处理已确认，现已转为 ready。";
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "隐私确认失败";
  }
}

async function resolveReport(item: ReportItem) {
  const actionRaw = window.prompt("处理动作：none、hide、restore", "none") ?? "none";
  const statusRaw = window.prompt("处理结果：resolved 或 dismissed", actionRaw === "none" ? "dismissed" : "resolved") ?? "dismissed";
  if (!["none", "hide", "restore"].includes(actionRaw) || !["resolved", "dismissed"].includes(statusRaw)) return;
  try {
    await apiFetch(`/moderation/reports/${item.id}/resolve`, {
      method: "POST",
      body: { action: actionRaw, status: statusRaw, notes: "由审核工作台处理" }
    });
    notice.value = "举报已处理。";
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "举报处理失败";
  }
}

const scopeSummary = computed(() =>
  scopes.value
    .flatMap((scope) => scope.permissions)
    .filter((value, index, all) => all.indexOf(value) === index)
    .map((permission) => MODERATION_PERMISSION_LABELS[permission])
);

onMounted(load);
</script>

<template>
  <section>
    <div class="page-heading">
      <div><h1>审核工作台</h1><p>所有批准、拒绝、隐私确认和举报处理都会写入审计日志。</p></div>
      <button class="button secondary" type="button" @click="load">刷新队列</button>
    </div>

    <p v-if="!isAdmin && scopes.length === 0" class="error-box">
      你当前没有任何有效的临时审核范围，无法执行审核动作。请联系管理员授予按分类与地区的委托。
    </p>
    <p v-else-if="!isAdmin" class="notice-box">
      你以受限审核员身份工作，仅可处理被委托范围内的内容。可执行：{{ scopeSummary.join("、") }}。
      灰色按钮表示该条目超出你的范围，接口同样会拒绝越权请求。
    </p>

    <p v-if="error" class="error-box">{{ error }}</p>
    <p v-if="notice" class="success-box">{{ notice }}</p>
    <div class="pill-tabs">
      <button :class="{ active: active === 'features' }" @click="active = 'features'">地点内容 {{ queue.counts.features }}</button>
      <button :class="{ active: active === 'comments' }" @click="active = 'comments'">评论 {{ queue.counts.comments }}</button>
      <button :class="{ active: active === 'media' }" @click="active = 'media'">隐私媒体 {{ queue.counts.media }}</button>
      <button :class="{ active: active === 'reports' }" @click="active = 'reports'">举报 {{ queue.counts.reports }}</button>
    </div>

    <div v-if="active === 'features'" class="moderation-grid">
      <article v-for="item in queue.features" :key="item.revision_id" class="card"><div class="card-body">
        <div class="inline"><span class="badge pending">待审核</span><span class="badge">{{ item.payload.categoryKey }}</span></div>
        <h3>{{ item.payload.title }}</h3>
        <p>{{ item.payload.description }}</p>
        <p class="muted">作者：{{ item.author_name }} · 修订 {{ item.revision_no }} · {{ new Date(item.submitted_at).toLocaleString() }}</p>
        <p v-if="item.payload.mediaIds?.length" class="notice-box">包含 {{ item.payload.mediaIds.length }} 张媒体，批准前所有媒体必须为 ready。</p>
        <div class="inline">
          <button :disabled="!can('feature.approve', item)" class="button" @click="featureAction(item, 'approve')">批准发布</button>
          <button :disabled="!can('feature.request_changes', item)" class="button secondary" @click="featureAction(item, 'request-changes')">要求修改</button>
          <button :disabled="!can('feature.reject', item)" class="button danger" @click="featureAction(item, 'reject')">拒绝</button>
          <button :disabled="!can('feature.hide', item)" class="button ghost" @click="featureAction(item, 'hide')">隐藏</button>
        </div>
      </div></article>
      <div v-if="!queue.features.length" class="card empty">没有你范围内待审核的地点内容。</div>
    </div>

    <div v-if="active === 'comments'" class="moderation-grid">
      <article v-for="item in queue.comments" :key="item.id" class="card"><div class="card-body">
        <p>{{ item.body }}</p>
        <p class="muted">{{ item.author_name }} · {{ new Date(item.created_at).toLocaleString() }}</p>
        <div class="inline">
          <button :disabled="!can('comment.approve', item)" class="button" @click="commentAction(item, 'approve')">批准</button>
          <button :disabled="!can('comment.reject', item)" class="button danger" @click="commentAction(item, 'reject')">拒绝</button>
          <button :disabled="!can('comment.hide', item)" class="button ghost" @click="commentAction(item, 'hide')">隐藏</button>
        </div>
      </div></article>
      <div v-if="!queue.comments.length" class="card empty">没有你范围内待审核的评论。</div>
    </div>

    <div v-if="active === 'media'" class="moderation-grid">
      <article v-for="item in queue.media" :key="item.id" class="card"><div class="card-body">
        <h3>{{ item.original_filename }}</h3>
        <p class="muted">上传者：{{ item.owner_name }} · 人工框选 {{ item.privacy_report.manualRegions?.length ?? 0 }} 个区域</p>
        <p class="notice-box">自动检测器{{ item.privacy_report.detectorConfigured ? "已启用" : "未启用" }}。服务端已应用人工框选，仍需审核员确认。</p>
        <img v-if="previews[item.id]" :src="previews[item.id]" alt="隐私处理结果预览" style="width:100%; border-radius:12px" />
        <div class="inline" style="margin-top: 12px">
          <button :disabled="!can('media.privacy_approve', item)" class="button secondary" @click="loadPreview(item)">生成 10 分钟预览</button>
          <button :disabled="!can('media.privacy_approve', item)" class="button" @click="approveMedia(item)">确认隐私并发布媒体</button>
        </div>
      </div></article>
      <div v-if="!queue.media.length" class="card empty">没有你范围内待确认的媒体。</div>
    </div>

    <div v-if="active === 'reports'" class="moderation-grid">
      <article v-for="item in queue.reports" :key="item.id" class="card"><div class="card-body">
        <div class="inline"><span class="badge pending">{{ item.target_type }}</span><span class="badge">{{ item.reason_code }}</span></div>
        <p>{{ item.notes || "无补充说明" }}</p>
        <p class="muted">举报人：{{ item.reporter_name }} · {{ new Date(item.created_at).toLocaleString() }}</p>
        <p class="muted">目标 ID：{{ item.target_id }}</p>
        <button :disabled="!can('report.resolve', item)" class="button" @click="resolveReport(item)">处理举报</button>
      </div></article>
      <div v-if="!queue.reports.length" class="card empty">没有你范围内待处理的举报。</div>
    </div>
  </section>
</template>
