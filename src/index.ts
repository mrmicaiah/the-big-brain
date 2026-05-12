import type { Env } from "./types";
import { requireAuth } from "./lib/auth";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Open: health check (no auth)
    if (url.pathname === "/health") {
      return json({ ok: true, version: env.GIT_SHA });
    }

    // Gated: API routes
    if (url.pathname.startsWith("/api/")) {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      // No routes yet — Phase 2 onward fills these in.
      return json({ error: "not_found" }, 404);
    }

    // Everything else: static assets / SPA fallback (index.html for client-side routes)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
