import type { Env } from "../types";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    public status: number,
    public body: string,
    public endpoint: string,
  ) {
    super(`GitHub ${endpoint} → ${status}: ${body.slice(0, 300)}`);
  }
}

/**
 * Single source of truth for GitHub request headers. Every function in this
 * file routes its request through `ghFetch`, which calls this helper. Never
 * construct GitHub headers anywhere else.
 *
 * - `Authorization: token <pat>` (classic-PAT form). `Bearer` is accepted for
 *   fine-grained PATs and OAuth tokens but inconsistent for classic; we pin
 *   `token` as the project default.
 * - `User-Agent` is required by GitHub.
 * - `X-GitHub-Api-Version` pins the API contract so future GitHub default
 *   changes don't surprise us.
 */
function ghHeaders(
  env: Env,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "Authorization": `token ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "the-big-brain",
    ...extra,
  };
}

async function ghFetch(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const extra = (init.headers as Record<string, string> | undefined) ?? {};
  return fetch(`${API}${path}`, {
    ...init,
    headers: ghHeaders(env, extra),
  });
}

export interface GhRepo {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  default_branch: string;
  clone_url: string;
  private: boolean;
  updated_at: string;
  fork: boolean;
  archived: boolean;
}

export async function listUserRepos(env: Env): Promise<GhRepo[]> {
  const endpoint = "/user/repos?affiliation=owner&sort=updated&per_page=100";
  const res = await ghFetch(env, endpoint);
  if (!res.ok) throw new GitHubError(res.status, await res.text(), `GET ${endpoint}`);
  return res.json() as Promise<GhRepo[]>;
}

export async function getRepo(env: Env, fullName: string): Promise<GhRepo | null> {
  const endpoint = `/repos/${fullName}`;
  const res = await ghFetch(env, endpoint);
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(res.status, await res.text(), `GET ${endpoint}`);
  return res.json() as Promise<GhRepo>;
}

export async function pathExists(
  env: Env,
  fullName: string,
  branch: string,
  path: string,
): Promise<boolean> {
  const endpoint = `/repos/${fullName}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await ghFetch(env, endpoint);
  if (res.status === 404) return false;
  if (!res.ok) throw new GitHubError(res.status, await res.text(), `GET ${endpoint}`);
  return true;
}

export async function createRepo(
  env: Env,
  args: { name: string; description: string; private: boolean },
): Promise<GhRepo> {
  const endpoint = "/user/repos";
  const res = await ghFetch(env, endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: args.name,
      description: args.description,
      private: args.private,
      auto_init: true,
    }),
  });
  if (!res.ok) throw new GitHubError(res.status, await res.text(), `POST ${endpoint}`);
  return res.json() as Promise<GhRepo>;
}

/**
 * Scaffold a set of files into a repo as a single commit on the default branch.
 *
 * Sequence: ref → commit → tree (with base_tree to preserve everything else) →
 * commit → ref-update. Five GitHub API calls; runs once per project ever.
 *
 * Every file in `files` is sent with explicit `content` (even `""`). See
 * ceoScaffold.ts for the empty-file pinning rationale.
 */
export async function scaffoldCeo(
  env: Env,
  fullName: string,
  branch: string,
  files: Record<string, string>,
  message: string,
): Promise<{ commitSha: string }> {
  // 1. Current ref → head commit sha
  const refEndpoint = `/repos/${fullName}/git/ref/heads/${branch}`;
  const refRes = await ghFetch(env, refEndpoint);
  if (!refRes.ok) {
    throw new GitHubError(refRes.status, await refRes.text(), `GET ${refEndpoint}`);
  }
  const refData = (await refRes.json()) as { object: { sha: string } };
  const headSha = refData.object.sha;

  // 2. Head commit → tree sha
  const commitEndpoint = `/repos/${fullName}/git/commits/${headSha}`;
  const commitRes = await ghFetch(env, commitEndpoint);
  if (!commitRes.ok) {
    throw new GitHubError(commitRes.status, await commitRes.text(), `GET ${commitEndpoint}`);
  }
  const commitData = (await commitRes.json()) as { tree: { sha: string } };
  const baseTreeSha = commitData.tree.sha;

  // 3. New tree on top of base
  const treeEntries = Object.entries(files).map(([path, content]) => ({
    path,
    mode: "100644" as const,
    type: "blob" as const,
    content, // explicit, even when ""
  }));
  const treeEndpoint = `/repos/${fullName}/git/trees`;
  const treeRes = await ghFetch(env, treeEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  if (!treeRes.ok) {
    throw new GitHubError(treeRes.status, await treeRes.text(), `POST ${treeEndpoint}`);
  }
  const treeData = (await treeRes.json()) as { sha: string };

  // 4. New commit pointing at the new tree
  const newCommitEndpoint = `/repos/${fullName}/git/commits`;
  const newCommitRes = await ghFetch(env, newCommitEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, tree: treeData.sha, parents: [headSha] }),
  });
  if (!newCommitRes.ok) {
    throw new GitHubError(
      newCommitRes.status,
      await newCommitRes.text(),
      `POST ${newCommitEndpoint}`,
    );
  }
  const newCommitData = (await newCommitRes.json()) as { sha: string };

  // 5. Move the branch ref forward
  const updateEndpoint = `/repos/${fullName}/git/refs/heads/${branch}`;
  const updateRes = await ghFetch(env, updateEndpoint, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sha: newCommitData.sha }),
  });
  if (!updateRes.ok) {
    throw new GitHubError(updateRes.status, await updateRes.text(), `PATCH ${updateEndpoint}`);
  }

  return { commitSha: newCommitData.sha };
}
