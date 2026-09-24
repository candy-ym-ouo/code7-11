import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { apiFetch, refreshSession } from "../lib/api";
import { getAccessToken, setAccessToken } from "../lib/session";

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  role: "contributor" | "moderator" | "admin";
  status: string;
  emailVerified: boolean;
};

export const useAuthStore = defineStore("auth", () => {
  const user = ref<CurrentUser | null>(null);
  const ready = ref(false);
  const isAuthenticated = computed(() => Boolean(user.value && getAccessToken()));
  const isVerified = computed(() => Boolean(user.value?.emailVerified));
  const canModerate = computed(() => user.value?.role === "moderator" || user.value?.role === "admin");

  async function bootstrap() {
    try {
      if (await refreshSession()) {
        user.value = await apiFetch<CurrentUser>("/me");
      }
    } catch {
      setAccessToken(null);
      user.value = null;
    } finally {
      ready.value = true;
    }
  }

  async function login(email: string, password: string) {
    const result = await apiFetch<{ accessToken: string; user: CurrentUser }>("/auth/login", {
      method: "POST",
      body: { email, password },
      skipRefresh: true
    });
    setAccessToken(result.accessToken);
    user.value = result.user;
  }

  async function register(email: string, password: string, displayName: string) {
    return apiFetch<{ status: string }>("/auth/register", {
      method: "POST",
      body: { email, password, displayName },
      skipRefresh: true
    });
  }

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST", skipRefresh: true }).catch(() => undefined);
    setAccessToken(null);
    user.value = null;
  }

  return { user, ready, isAuthenticated, isVerified, canModerate, bootstrap, login, register, logout };
});
