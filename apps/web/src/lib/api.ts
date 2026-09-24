import { getAccessToken, getCookie, setAccessToken } from "./session";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  skipRefresh?: boolean;
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return await response.json() as T;
  return await response.text() as T;
}

let refreshPromise: Promise<boolean> | null = null;

function performRefresh(): Promise<boolean> {
  const csrf = getCookie("map_csrf");
  if (!csrf) return Promise.resolve(false);
  return (async () => {
    try {
      const response = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": csrf }
      });
      if (!response.ok) {
        setAccessToken(null);
        return false;
      }
      const payload = await parseResponse<{ accessToken: string }>(response);
      setAccessToken(payload.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    }
  })();
}

export function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipRefresh, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");

  const requestInit: RequestInit = {
    ...fetchOptions,
    headers,
    credentials: "include"
  };
  if (body !== undefined) requestInit.body = JSON.stringify(body);

  const response = await fetch(`/api/v1${path}`, requestInit);

  if (response.status === 401 && !skipRefresh && !path.startsWith("/auth/")) {
    if (await refreshSession()) return apiFetch<T>(path, { ...options, skipRefresh: true });
  }

  if (!response.ok) {
    let problem: Record<string, unknown> = {};
    try {
      problem = await parseResponse<Record<string, unknown>>(response);
    } catch {
      problem = {};
    }
    throw new ApiError(
      response.status,
      typeof problem.code === "string" ? problem.code : typeof problem.title === "string" ? problem.title : "REQUEST_FAILED",
      typeof problem.detail === "string" ? problem.detail : `Request failed with ${response.status}`,
      problem.details
    );
  }
  return parseResponse<T>(response);
}

export async function uploadFile(url: string, file: File): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file
  });
  if (!response.ok) throw new ApiError(response.status, "UPLOAD_FAILED", "图片上传失败");
}
