import type { Env } from "../types";

/**
 * Require a Bearer token matching env.AUTH_TOKEN on the request.
 * Returns null when authorized, or a 401 Response when denied.
 *
 * Single-user system; the token is shared between Worker and SPA.
 * Length-checked before string-compared to avoid the most obvious
 * timing leak, but this is not a true timing-safe compare — the
 * threat model is a single operator on a single domain.
 */
export function requireAuth(request: Request, env: Env): Response | null {
  const header = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${env.AUTH_TOKEN}`;
  if (header.length !== expected.length || header !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}
