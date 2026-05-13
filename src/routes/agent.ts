import type { Env } from "../types";

/**
 * GET /api/agent/ws — local agent WebSocket entry point.
 *
 * Auth is `Bearer AGENT_TOKEN` (distinct from AUTH_TOKEN — the agent uses its
 * own bearer so leaking either doesn't cross-compromise). Verified at the
 * Worker before forwarding to AgentHubDO so a revoked token rejects without
 * touching the DO.
 *
 * On success, forwards the upgrade request to AgentHubDO's /connect handler,
 * which does the WebSocketPair dance.
 */
export async function handleAgentWebSocket(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  // Must be a WebSocket upgrade
  const upgrade = request.headers.get("upgrade");
  if (upgrade?.toLowerCase() !== "websocket") {
    return new Response("expected websocket upgrade", { status: 426 });
  }

  // Bearer AGENT_TOKEN required
  const header = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${env.AGENT_TOKEN}`;
  if (header.length !== expected.length || header !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Forward to the singleton AgentHubDO
  const stub = env.AGENT_HUB_DO.get(env.AGENT_HUB_DO.idFromName("singleton"));
  return stub.fetch(
    new Request("https://do/connect", {
      method: "GET",
      headers: {
        upgrade: "websocket",
        connection: request.headers.get("connection") ?? "Upgrade",
      },
    }),
  );
}
