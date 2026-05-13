import type { Env } from "../types";

const API = "https://api.github.com";

/**
 * Fetch a single file's text contents via the GitHub Contents API. Returns
 * "" when the file doesn't exist (404) — `.ceo/goal.md` and `.ceo/context.md`
 * are deliberately empty on a fresh scaffold, and we don't want a 404 on
 * those to fail the chat.
 */
async function fetchOneFile(
  env: Env,
  repoFullName: string,
  path: string,
  branch: string,
): Promise<string> {
  const url = `${API}/repos/${repoFullName}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `token ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "the-big-brain",
    },
  });
  if (res.status === 404) return "";
  if (!res.ok) {
    throw new Error(`GitHub GET ${path} → ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { content: string; encoding: string };
  if (data.encoding !== "base64") {
    throw new Error(`Unexpected encoding ${data.encoding} for ${path}`);
  }
  // base64 → utf-8
  const binary = atob(data.content.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export interface CeoFiles {
  goal: string;
  context: string;
  decisions: string;
  board: string;
}

/**
 * Read the four `.ceo/` content files in parallel. README.md is metadata for
 * humans and is not part of the manager prompt.
 */
export async function readCeoFiles(
  env: Env,
  repoFullName: string,
  branch: string,
): Promise<CeoFiles> {
  const [goal, context, decisions, board] = await Promise.all([
    fetchOneFile(env, repoFullName, ".ceo/goal.md", branch),
    fetchOneFile(env, repoFullName, ".ceo/context.md", branch),
    fetchOneFile(env, repoFullName, ".ceo/decisions.md", branch),
    fetchOneFile(env, repoFullName, ".ceo/board.md", branch),
  ]);
  return { goal, context, decisions, board };
}
