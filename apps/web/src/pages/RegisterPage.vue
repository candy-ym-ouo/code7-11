<script setup lang="ts">
import { ref } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const email = ref("");
const password = ref("");
const displayName = ref("");
const error = ref("");
const success = ref("");
const busy = ref(false);

async function register() {
  error.value = "";
  busy.value = true;
  try {
    await auth.register(email.value, password.value, displayName.value);
    success.value = "注册成功。验证邮件已发送，请打开邮件中的链接完成验证。";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "注册失败";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section style="max-width: 560px; margin: 40px auto">
    <div class="card"><div class="card-body">
      <h1>注册贡献者账号</h1>
      <p class="muted">密码至少 10 个字符。开发环境验证邮件可在 Mailpit 中查看。</p>
      <p v-if="error" class="error-box">{{ error }}</p>
      <p v-if="success" class="success-box">{{ success }}</p>
      <form @submit.prevent="register">
        <div class="field"><label>昵称</label><input v-model="displayName" minlength="2" maxlength="40" required /></div>
        <div class="field"><label>邮箱</label><input v-model="email" type="email" autocomplete="email" required /></div>
        <div class="field"><label>密码</label><input v-model="password" type="password" minlength="10" autocomplete="new-password" required /></div>
        <button class="button" type="submit" :disabled="busy">{{ busy ? "注册中…" : "注册并发送验证邮件" }}</button>
      </form>
      <p style="margin-top: 20px">已有账号？<RouterLink to="/login" style="color: var(--teal)">登录</RouterLink></p>
    </div></div>
  </section>
</template>
