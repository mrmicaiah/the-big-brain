import type { Env } from "../types";

/**
 * GET /api/jobs/:id          → snapshot from D1
 * GET /api/jobs/:id/stream   → forwarded to AgentHubDO for SSE
 * GET /api/chats/:chatId/jobs → all jobs for a chat (history reload)
 */

interface JobRow {
  id: string;
  project_id: string;
  chat_id: string;
  prompt: string;
  summary: string;
  status: string;
  output_stream: string | null;
  diff_summary: string | null;
  created_at: string;
  completed_at: string | null;
  manager_seen_at: string | null;
  message_id: string | null;
  fence_index: number | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleGetJob(
  _request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const id = params.id;
  if (!id) return json({ error: "invalid_id" }, 400);
  const row = await env.DB.prepare(`SELECT * FROM execution_jobs WHERE id = ?`)
    .bind(id)
    .first<JobRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json(row);
}

export async function handleStreamJob(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const id = params.id;
  if (!id) return json({ error: "invalid_id" }, 400);
  const stub = env.AGENT_HUB_DO.get(env.AGENT_HUB_DO.idFromName("singleton"));
  // Forward Accept header so the DO sees this is an SSE request (not strictly
  // required — the DO produces SSE regardless — but kept for parity).
  return stub.fetch(
    new Request(`https://do/subscribe?jobId=${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { accept: request.headers.get("accept") ?? "text/event-stream" },
    }),
  );
}

export async function handleListJobsForChat(
  _request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const chatId = params.chatId;
  if (!chatId) return json({ error: "invalid_chat_id" }, 400);
  const rows = await env.DB.prepare(
    `SELECT * FROM execution_jobs WHERE chat_id = ? ORDER BY created_at ASC, id ASC`,
  )
    .bind(chatId)
    .all<JobRow>();
  return json({ jobs: rows.results ?? [] });
}
