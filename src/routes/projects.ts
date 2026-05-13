import type { Env } from "../types";
import {
  createRepo,
  getRepo,
  pathExists,
  scaffoldCeo,
  GitHubError,
} from "../lib/github";
import { buildCeoFiles } from "../lib/ceoScaffold";
import { newId } from "../lib/ids";

const SCAFFOLD_MESSAGE = "Scaffold .ceo/ for The Big Brain";

interface ProjectRow {
  id: string;
  repo_full_name: string;
  clone_url: string;
  default_branch: string;
  created_at: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ghErrorResponse(err: GitHubError, errorTag: string, status = 502): Response {
  return jsonResponse(
    { error: errorTag, github_status: err.status, message: err.body },
    status,
  );
}

/**
 * POST /api/projects/from-repo — idempotent claim.
 *
 * Three cases (plan §endpoint behaviors):
 *   (a) D1 row exists                  → return existing, isNew=false, no GH calls
 *   (b) no D1 row + .ceo/ exists in repo → insert row only, isNew=false
 *   (c) no D1 row + no .ceo/ in repo     → scaffold + insert row, isNew=true
 */
export async function handleClaimRepo(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  let body: { repo_full_name?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (typeof body.repo_full_name !== "string" || !body.repo_full_name.includes("/")) {
    return jsonResponse({ error: "invalid_repo_full_name" }, 400);
  }
  const repoFullName = body.repo_full_name;

  // (a) row exists?
  const existing = await env.DB.prepare(
    "SELECT * FROM projects WHERE repo_full_name = ?",
  )
    .bind(repoFullName)
    .first<ProjectRow>();
  if (existing) {
    return jsonResponse({
      projectId: existing.id,
      repo_full_name: existing.repo_full_name,
      isNew: false,
    });
  }

  // Fetch repo metadata
  let repo;
  try {
    repo = await getRepo(env, repoFullName);
  } catch (err) {
    if (err instanceof GitHubError) return ghErrorResponse(err, "github_error");
    throw err;
  }
  if (!repo) return jsonResponse({ error: "repo_not_found" }, 404);

  // .ceo/ already present?
  let hasCeo: boolean;
  try {
    hasCeo = await pathExists(env, repoFullName, repo.default_branch, ".ceo");
  } catch (err) {
    if (err instanceof GitHubError) return ghErrorResponse(err, "github_error");
    throw err;
  }

  // Scaffold if missing
  if (!hasCeo) {
    try {
      await scaffoldCeo(
        env,
        repoFullName,
        repo.default_branch,
        buildCeoFiles(),
        SCAFFOLD_MESSAGE,
      );
    } catch (err) {
      if (err instanceof GitHubError) return ghErrorResponse(err, "scaffold_failed");
      throw err;
    }
  }

  // Insert D1 row (catches the SELECT-then-INSERT race via UNIQUE)
  const projectId = newId();
  try {
    await env.DB.prepare(
      `INSERT INTO projects (id, repo_full_name, clone_url, default_branch)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(projectId, repoFullName, repo.clone_url, repo.default_branch)
      .run();
  } catch {
    // Likely UNIQUE collision from a concurrent claim. Re-fetch and return.
    const recheck = await env.DB.prepare(
      "SELECT * FROM projects WHERE repo_full_name = ?",
    )
      .bind(repoFullName)
      .first<ProjectRow>();
    if (recheck) {
      return jsonResponse({
        projectId: recheck.id,
        repo_full_name: recheck.repo_full_name,
        isNew: false,
      });
    }
    throw new Error("D1 insert failed and re-fetch returned nothing");
  }

  return jsonResponse({
    projectId,
    repo_full_name: repoFullName,
    isNew: !hasCeo,
  });
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * POST /api/projects/new — create a fresh GitHub repo + claim it.
 */
export async function handleNewProject(
  request: Request,
  env: Env,
  _params: Record<string, string>,
): Promise<Response> {
  let body: { name?: unknown; description?: unknown; private?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const name = typeof body.name === "string" ? body.name : "";
  const description = typeof body.description === "string" ? body.description : "";
  const isPrivate = typeof body.private === "boolean" ? body.private : true;

  if (!name || name.length > 100 || !NAME_RE.test(name)) {
    return jsonResponse(
      { error: "invalid_name", message: "lowercase, [a-z0-9._-], ≤100 chars" },
      400,
    );
  }
  if (description.length > 350) {
    return jsonResponse(
      { error: "invalid_description", message: "≤350 chars" },
      400,
    );
  }

  // 1. Create the repo
  let repo;
  try {
    repo = await createRepo(env, { name, description, private: isPrivate });
  } catch (err) {
    if (err instanceof GitHubError) {
      // GitHub returns 422 when name collides with an existing repo
      const httpStatus = err.status === 422 ? 409 : 502;
      return ghErrorResponse(err, "create_repo_failed", httpStatus);
    }
    throw err;
  }

  // 2. Scaffold with one retry — GitHub takes ~1s for the new repo's git data
  //    to be reachable.
  let scaffoldErr: unknown = null;
  let scaffolded = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      await scaffoldCeo(
        env,
        repo.full_name,
        repo.default_branch,
        buildCeoFiles(),
        SCAFFOLD_MESSAGE,
      );
      scaffolded = true;
      break;
    } catch (err) {
      scaffoldErr = err;
      // Retry only on 404 (propagation delay); other errors bail immediately.
      if (err instanceof GitHubError && err.status === 404 && attempt === 0) continue;
      break;
    }
  }
  if (!scaffolded) {
    if (scaffoldErr instanceof GitHubError) {
      return ghErrorResponse(scaffoldErr, "scaffold_failed");
    }
    throw scaffoldErr;
  }

  // 3. Insert D1 row
  const projectId = newId();
  await env.DB.prepare(
    `INSERT INTO projects (id, repo_full_name, clone_url, default_branch)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(projectId, repo.full_name, repo.clone_url, repo.default_branch)
    .run();

  return jsonResponse({
    projectId,
    repo_full_name: repo.full_name,
    isNew: true,
  });
}

/**
 * GET /api/projects/:id — single D1 row. 404 path is what the frontend leans on
 * to silently drop stale localStorage entries after a D1 wipe.
 */
export async function handleGetProject(
  _request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const id = params.id;
  if (!id) return jsonResponse({ error: "invalid_id" }, 400);

  const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(id)
    .first<ProjectRow>();
  if (!row) return jsonResponse({ error: "not_found" }, 404);

  return jsonResponse(row);
}
