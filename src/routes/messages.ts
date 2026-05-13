import type { Env } from "../types";

interface MessageRow {
  id: string;
  role: string;
  brain: string | null;
  content: string;
  created_at: string;
}

/**
 * GET /api/chats/:chatId/messages
 * Returns the full message list for a chat. Used by the frontend to render
 * history when a project pane mounts.
 */
export async function handleListMessages(
  _request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const chatId = params.chatId;
  if (!chatId) return json({ error: "invalid_chat_id" }, 400);

  // Verify the chat exists (gives a clean 404 rather than empty list)
  const chat = await env.DB.prepare("SELECT id FROM chats WHERE id = ?")
    .bind(chatId)
    .first<{ id: string }>();
  if (!chat) return json({ error: "not_found" }, 404);

  const rows = await env.DB.prepare(
    "SELECT id, role, brain, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC",
  )
    .bind(chatId)
    .all<MessageRow>();

  return json({ messages: rows.results ?? [] });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
