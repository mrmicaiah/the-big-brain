import type { Env } from "../types";
import { newId } from "../lib/ids";

/**
 * POST /api/projects/:id/dispatch-claude-code
 *
 * Body: { chatId, messageId?, fenceIndex?, summary, prompt }
 *
 * Creates the execution_jobs row (status='queued'), then forwards a dispatch
 * to AgentHubDO. Returns { jobId } to the frontend, which then subscribes to
 * /api/jobs/:jobId/stream for live output.
 */

interface ProjectRow {
  id: string;
  repo_full_name: string;
  clone_url: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function repoNameFromFullName(fullName: string): string {
  const i = fullName.indexOf("/");
  return i < 0 ? fullName : fullName.slice(i + 1);
}

export async function handleDispatchClaudeCode(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const projectId = params.id;
  if (!projectId) return json({ error: "invalid_id" }, 400);

  let body: {
    chatId?: unknown;
    messageId?: unknown;
    fenceIndex?: unknown;
    summary?: unknown;
    prompt?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (typeof body.chatId !== "string" || typeof body.prompt !== "string") {
    return json({ error: "invalid_body" }, 400);
  }
  const chatId = body.chatId;
  const prompt = body.prompt;
  const summary = typeof body.summary === "string" ? body.summary : prompt.slice(0, 80);
  const messageId = typeof body.messageId === "string" ? body.messageId : null;
  const fenceIndex =
    typeof body.fenceIndex === "number" && Number.isInteger(body.fenceIndex)
      ? body.fenceIndex
      : null;

  // Validate project + load repo metadata for the agent
  const project = await env.DB.prepare(
    `SELECT id, repo_full_name, clone_url FROM projects WHERE id = ?`,
  )
    .bind(projectId)
    .first<ProjectRow>();
  if (!project) return json({ error: "project_not_found" }, 404);

  // Validate chat belongs to project (cheap consistency check)
  const chat = await env.DB.prepare(
    `SELECT id FROM chats WHERE id = ? AND project_id = ?`,
  )
    .bind(chatId, projectId)
    .first();
  if (!chat) return json({ error: "chat_not_found" }, 404);

  // Insert the job row (status='queued')
  const jobId = newId();
  await env.DB.prepare(
    `INSERT INTO execution_jobs
       (id, project_id, chat_id, prompt, summary, status, message_id, fence_index)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
  )
    .bind(jobId, projectId, chatId, prompt, summary, messageId, fenceIndex)
    .run();

  // Hand off to AgentHubDO
  const stub = env.AGENT_HUB_DO.get(env.AGENT_HUB_DO.idFromName("singleton"));
  const repoName = repoNameFromFullName(project.repo_full_name);
  await stub.fetch(
    new Request("https://do/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobId,
        projectId,
        chatId,
        repoName,
        cloneUrl: project.clone_url,
        prompt,
      }),
    }),
  );

  return json({ jobId });
}
