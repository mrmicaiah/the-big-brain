import type { Env } from "../types";
import { listUserRepos, GitHubError } from "../lib/github";

interface ProjectRow {
  id: string;
  repo_full_name: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleListRepos(
  _request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  let repos;
  try {
    repos = await listUserRepos(env);
  } catch (err) {
    if (err instanceof GitHubError) {
      return jsonResponse(
        { error: "github_error", status: err.status, message: err.body },
        502,
      );
    }
    throw err;
  }

  // Plan §2: filter forks and archived. They clutter the picker and aren't
  // useful project candidates.
  const candidates = repos.filter((r) => !r.fork && !r.archived);

  const rows = await env.DB.prepare(
    "SELECT id, repo_full_name FROM projects",
  ).all<ProjectRow>();
  const projectMap = new Map<string, string>();
  for (const row of rows.results ?? []) {
    projectMap.set(row.repo_full_name, row.id);
  }

  const annotated = candidates.map((r) => {
    const projectId = projectMap.get(r.full_name);
    return {
      full_name: r.full_name,
      name: r.name,
      description: r.description,
      default_branch: r.default_branch,
      clone_url: r.clone_url,
      private: r.private,
      updated_at: r.updated_at,
      isProject: projectId !== undefined,
      ...(projectId !== undefined ? { projectId } : {}),
    };
  });

  return jsonResponse({ repos: annotated });
}
