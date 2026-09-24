<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { apiFetch } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const error = ref("");
const notice = ref("");

async function exportData() {
  try {
    const data = await apiFetch<Record<string, unknown>>("/me/export", { method: "POST" });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `map-account-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notice.value = "账号数据已导出。";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "导出失败";
  }
}

async function deleteAccount() {
  const confirmation = window.prompt("此操作不可撤销。输入 DELETE 确认进入 30 天删除冷静期。");
  if (confirmation !== "DELETE") return;
  try {
    await apiFetch("/me/delete", { method: "POST" });
    await auth.logout();
    await router.push("/map");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "删除申请失败";
  }
}
</script>

<template>
  <section style="max-width: 760px; margin: 30px auto">
    <div class="page-heading"><div><h1>账号设置</h1><p>管理账号数据导出和删除申请。</p></div></div>
    <p v-if="error" class="error-box">{{ error }}</p>
    <p v-if="notice" class="success-box">{{ notice }}</p>
    <div class="stack">
      <section class="card"><div class="card-body">
        <h2>数据导出</h2>
        <p class="muted">导出账号资料、投稿、评论和时效确认。敏感媒体不会以内嵌原图形式导出。</p>
        <button class="button secondary" type="button" @click="exportData">导出 JSON</button>
      </div></section>
      <section class="card"><div class="card-body">
        <h2>删除账号</h2>
        <p class="muted">申请后进入 30 天冷静期。冷静期结束后身份信息匿名化，媒体按保留策略删除。</p>
        <button class="button danger" type="button" @click="deleteAccount">申请删除账号</button>
      </div></section>
    </div>
  </section>
</template>
