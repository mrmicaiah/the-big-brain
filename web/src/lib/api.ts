const TOKEN = import.meta.env.VITE_AUTH_TOKEN as string;

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Authenticated JSON fetch helper.
 *
 * Auth header is always sent. Content-type is only set when `init.body` is a
 * **string** (JSON output) — never for FormData, which needs the browser to
 * set its own multipart/form-data boundary. Phase 8 (uploads) depends on this.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const isJsonBody = typeof init.body === "string";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${TOKEN}`,
    ...(isJsonBody ? { "content-type": "application/json" } : {}),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json() as Promise<T>;
}

/**
 * Same auth/header logic as apiFetch but returns the raw Response without
 * consuming the body. Used for SSE streams where the caller needs to read
 * the body chunk-by-chunk via res.body.getReader().
 */
export async function apiFetchRaw(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const isJsonBody = typeof init.body === "string";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${TOKEN}`,
    ...(isJsonBody ? { "content-type": "application/json" } : {}),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res;
}
