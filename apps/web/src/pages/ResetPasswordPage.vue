<script setup lang="ts">
import { ref } from "vue";
import { useRoute } from "vue-router";
import { apiFetch } from "../lib/api";

const route = useRoute();
const password = ref("");
const error = ref("");
const success = ref("");
const token = typeof route.query.token === "string" ? route.query.token : "";

async function reset() {
  error.value = "";
  try {
    await apiFetch("/auth/password/reset", {
      method: "POST",
      body: { token, password: password.value },
      skipRefresh: true
    });
    success.value = "密码已重置，请使用新密码登录。";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "重置失败";
  }
}
</script>

<template>
  <section style="max-width: 540px; margin: 50px auto">
    <div class="card"><div class="card-body">
      <h1>重置密码</h1>
      <p v-if="error" class="error-box">{{ error }}</p>
      <p v-if="success" class="success-box">{{ success }}</p>
      <form v-if="!success" @submit.prevent="reset">
        <div class="field"><label>新密码</label><input v-model="password" type="password" minlength="10" required /></div>
        <button class="button" type="submit">确认重置</button>
      </form>
      <RouterLink v-else class="button" to="/login">返回登录</RouterLink>
    </div></div>
  </section>
</template>
