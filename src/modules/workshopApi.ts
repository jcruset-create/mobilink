import { API_BASE } from "./workshopConstants";

export async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs = 8000
) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    return response;
  } finally {
    window.clearTimeout(timer);
  }
}

export function getAdminHeaders(extra?: HeadersInit): HeadersInit {
  const token = localStorage.getItem("sea-admin-token") ?? "";

  return {
    ...(extra ?? {}),
    "x-admin-token": token,
  };
}

export { API_BASE };