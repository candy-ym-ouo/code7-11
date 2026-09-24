<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiFetch } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const notice = ref(route.query.verify ? "请先完成邮箱验证，再提交内容和评论。" : "");
const busy = ref(false);
const redirect = computed(() => typeof route.query.redirect === "string" ? route.query.redirect : "/map");

async function login() {
  error.value = "";
  busy.value = true;
  try {
    await auth.login(email.value, password.value);
    await router.push(redirect.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "登录失败";
  } finally {
    busy.value = false;
  }
}

async function forgot() {
  if (!email.value) {
    error.value = "请先填写邮箱。";
    return;
  }
  try {
    await apiFetch("/auth/password/forgot", { method: "POST", body: { email: email.value }, skipRefresh: true });
    notice.value = "如果账号存在，密码重置邮件已发送，请检查 Mailpit 或邮箱。";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "发送失败";
  }
}
</script>

<template>
  <section style="max-width: 520px; margin: 40px auto">
    <div class="card"><div class="card-body">
      <h1>登录</h1>
      <p class="muted">浏览无需登录；投稿、评论、举报和时效确认需要账号。</p>
      <p v-if="error" class="error-box">{{ error }}</p>
      <p v-if="notice" class="notice-box">{{ notice }}</p>
      <form @submit.prevent="login">
        <div class="field"><label>邮箱</label><input v-model="email" type="email" autocomplete="email" required /></div>
        <div class="field"><label>密码</label><input v-model="password" type="password" autocomplete="current-password" required /></div>
        <div class="inline" style="justify-content: space-between">
          <button class="button" type="submit" :disabled="busy">{{ busy ? "登录中…" : "登录" }}</button>
          <button class="button ghost small" type="button" @click="forgot">忘记密码</button>
        </div>
      </form>
      <p style="margin-top: 20px">没有账号？<RouterLink to="/register" style="color: var(--teal)">注册</RouterLink></p>
    </div></div>
  </section>
</template>
