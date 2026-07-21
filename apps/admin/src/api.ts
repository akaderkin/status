const TOKEN_KEY = "status_admin_token";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const o = data as {
      error?: string;
      message?: string;
      details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
    };
    if (typeof o.error === "string" && o.error) {
      if (o.details?.fieldErrors) {
        const parts = Object.entries(o.details.fieldErrors)
          .flatMap(([k, v]) => (v || []).map((msg) => `${k}: ${msg}`));
        if (parts.length) return `${o.error} — ${parts.join("; ")}`;
      }
      return o.error;
    }
    if (typeof o.message === "string" && o.message) return o.message;
  }
  if (status === 401) return "Oturum süresi doldu — tekrar giriş yap";
  if (status === 403) return "Yetkin yok";
  if (status === 404) return "Kayıt bulunamadı";
  if (status === 409) return "Bağlı kayıtlar var; önce onları sil";
  return `HTTP ${status}`;
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...opts, headers, body });
  } catch {
    throw new Error(
      API_BASE
        ? `API'ye ulaşılamıyor (${API_BASE})`
        : "API'ye ulaşılamıyor — VITE_API_URL ayarlı mı?"
    );
  }

  if (res.status === 204 || res.status === 205) {
    return undefined as T;
  }

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 180) || `HTTP ${res.status}` };
    }
  }

  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new Error(errorMessage(data, res.status));
  }

  return data as T;
}

/** Confirm + DELETE with clear errors */
export async function apiDelete(path: string, label?: string): Promise<void> {
  const ok = window.confirm(label ? `Silinsin mi: ${label}?` : "Bu kaydı silmek istiyor musun?");
  if (!ok) throw new Error("CANCELLED");
  await api(path, { method: "DELETE" });
}
