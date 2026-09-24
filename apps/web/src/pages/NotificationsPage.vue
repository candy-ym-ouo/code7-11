<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiFetch } from "../lib/api";

type Notification = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const items = ref<Notification[]>([]);
const error = ref("");

async function load() {
  try {
    items.value = await apiFetch<Notification[]>("/me/notifications");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "加载通知失败";
  }
}

async function markRead(item: Notification) {
  if (item.read_at) return;
  await apiFetch(`/me/notifications/${item.id}/read`, { method: "POST" });
  item.read_at = new Date().toISOString();
}

onMounted(load);
</script>

<template>
  <section>
    <div class="page-heading"><div><h1>通知</h1><p>审核结果、举报处理和相关内容状态变化。</p></div></div>
    <p v-if="error" class="error-box">{{ error }}</p>
    <div v-if="!items.length" class="card empty">没有通知。</div>
    <div v-else class="stack">
      <article v-for="item in items" :key="item.id" class="card" :class="{ unread: !item.read_at }"><div class="card-body">
        <div class="inline" style="justify-content: space-between">
          <strong>{{ item.title }}</strong>
          <small class="muted">{{ new Date(item.created_at).toLocaleString() }}</small>
        </div>
        <p>{{ item.body }}</p>
        <div class="inline">
          <RouterLink v-if="item.link" class="button ghost small" :to="item.link" @click="markRead(item)">查看</RouterLink>
          <button v-if="!item.read_at" class="button secondary small" type="button" @click="markRead(item)">标为已读</button>
        </div>
      </div></article>
    </div>
  </section>
</template>
