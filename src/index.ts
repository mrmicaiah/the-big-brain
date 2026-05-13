import type { Env } from "./types";
import { requireAuth } from "./lib/auth";
import { dispatch } from "./lib/router";
import { apiRoutes } from "./routes";

// Export DO classes so the Workers runtime can find them when invoked
// via env.MANAGER_DO.idFromName(...).get(...).
export { ManagerDO } from "./durable-objects/manager";

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

      const matched = await dispatch(apiRoutes, request, env);
      if (matched) return matched;
      return json({ error: "not_found" }, 404);
    }

    // Everything else: static assets / SPA fallback
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
