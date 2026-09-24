<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { apiFetch } from "../lib/api";

const route = useRoute();
const status = ref("正在验证…");
const error = ref("");

onMounted(async () => {
  const token = typeof route.query.token === "string" ? route.query.token : "";
  if (!token) {
    error.value = "验证链接缺少令牌。";
    return;
  }
  try {
    await apiFetch("/auth/verify-email", { method: "POST", body: { token }, skipRefresh: true });
    status.value = "邮箱验证完成，现在可以投稿和评论。";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "验证失败";
  }
});
</script>

<template>
  <section style="max-width: 620px; margin: 60px auto">
    <div class="card"><div class="card-body">
      <h1>邮箱验证</h1>
      <p v-if="error" class="error-box">{{ error }}</p>
      <p v-else class="success-box">{{ status }}</p>
      <RouterLink class="button" to="/login">前往登录</RouterLink>
    </div></div>
  </section>
</template>
