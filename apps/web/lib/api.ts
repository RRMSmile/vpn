export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export async function apiFetch(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers || {}) }
  });
}