<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiFetch } from "../lib/api";

type OwnComment = {
  id: string;
  feature_id: string;
  body: string;
  status: string;
  rejection_reason_code: string | null;
  created_at: string;
  updated_at: string;
  feature_status: string;
  feature_title: string | null;
};

const items = ref<OwnComment[]>([]);
const error = ref("");
const statusLabels: Record<string, string> = {
  pending: "审核中", published: "已发布", rejected: "已拒绝", hidden: "已隐藏", deleted: "已删除"
};

onMounted(async () => {
  try {
    items.value = await apiFetch<OwnComment[]>("/me/comments");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "加载评论失败";
  }
});
</script>

<template>
  <section>
    <div class="page-heading"><div><h1>我的评论</h1><p>评论默认先审后发，编辑后会重新进入审核。</p></div></div>
    <p v-if="error" class="error-box">{{ error }}</p>
    <div v-if="!items.length" class="card empty">还没有评论。</div>
    <div v-else class="stack">
      <article v-for="item in items" :key="item.id" class="card"><div class="card-body">
        <div class="inline" style="justify-content: space-between">
          <span class="badge" :class="item.status">{{ statusLabels[item.status] ?? item.status }}</span>
          <small class="muted">{{ new Date(item.created_at).toLocaleString() }}</small>
        </div>
        <p style="white-space: pre-wrap">{{ item.body }}</p>
        <p v-if="item.rejection_reason_code" class="error-box">{{ item.rejection_reason_code }}</p>
        <RouterLink v-if="item.feature_status === 'published'" class="button ghost small" :to="`/features/${item.feature_id}`">
          查看：{{ item.feature_title ?? "地点详情" }}
        </RouterLink>
      </div></article>
    </div>
  </section>
</template>
