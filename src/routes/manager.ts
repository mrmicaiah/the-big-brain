import type { Env } from "../types";

interface ProjectRow {
  id: string;
  repo_full_name: string;
  default_branch: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function projectStub(
  env: Env,
  projectId: string,
): Promise<{ project: ProjectRow; stub: DurableObjectStub } | null> {
  const project = await env.DB.prepare(
    "SELECT id, repo_full_name, default_branch FROM projects WHERE id = ?",
  )
    .bind(projectId)
    .first<ProjectRow>();
  if (!project) return null;
  const id = env.MANAGER_DO.idFromName(project.repo_full_name);
  return { project, stub: env.MANAGER_DO.get(id) };
}

function contextHeaders(project: ProjectRow): HeadersInit {
  return {
    "x-project-id": project.id,
    "x-repo-full-name": project.repo_full_name,
    "x-default-branch": project.default_branch,
  };
}

/**
 * GET /api/projects/:id/manager-chat
 * Idempotent resolve of the canonical manager chat for this project.
 */
export async function handleManagerChatResolve(
  _request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const id = params.id;
  if (!id) return jsonResponse({ error: "invalid_id" }, 400);
  const got = await projectStub(env, id);
  if (!got) return jsonResponse({ error: "not_found" }, 404);
  return got.stub.fetch(
    new Request("https://do/resolve", {
      method: "GET",
      headers: contextHeaders(got.project),
    }),
  );
}

/**
 * POST /api/projects/:id/manager/chat
 * Streamed chat turn. Forwards body + project context headers to the DO.
 */
export async function handleManagerChat(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const id = params.id;
  if (!id) return jsonResponse({ error: "invalid_id" }, 400);
  const got = await projectStub(env, id);
  if (!got) return jsonResponse({ error: "not_found" }, 404);

  const body = await request.text();
  return got.stub.fetch(
    new Request("https://do/chat", {
      method: "POST",
      headers: {
        ...contextHeaders(got.project),
        "content-type": "application/json",
      },
      body,
    }),
  );
}
