import type { Env } from "../types";

const API = "https://api.github.com";

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_BATCH_FILES = 10;

/**
 * Tool result shape — the `content` field is what flows back to Anthropic as
 * the `tool_result` block. The `summary` is for the SSE `tool` event the
 * frontend renders as an inline status line. See docs/phase-3-5-plan.md
 * §"Tool event summary format" for the contract on `summary`.
 */
export interface ToolResultWithSummary {
  content: string;
  is_error?: boolean;
  summary: string;
}

function ghHeaders(env: Env): Record<string, string> {
  return {
    "Authorization": `token ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "the-big-brain",
  };
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Encode a repo-relative path for the GitHub Contents API URL — preserve
 *  slashes between segments, escape everything else. */
function encodeRepoPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

interface ContentsListEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size?: number;
}

/**
 * list_repo_files — directory listing via the Contents API.
 *
 * Output contract (pinned in docs/phase-3-5-plan.md):
 *   - dirs render as `name/` (trailing slash, no size) — visually distinct
 *   - files render as `name (humanSize)`
 *   - dirs sorted alphabetically, then files sorted alphabetically
 */
export async function listRepoFiles(
  env: Env,
  repoFullName: string,
  branch: string,
  input: Record<string, unknown>,
): Promise<ToolResultWithSummary> {
  let path = typeof input.path === "string" ? input.path : "";
  // Normalize: strip leading/trailing slashes, treat "." as root
  path = path.replace(/^\/+|\/+$/g, "");
  if (path === ".") path = "";

  const displayPath = path || "/";
  const url = path
    ? `${API}/repos/${repoFullName}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(branch)}`
    : `${API}/repos/${repoFullName}/contents?ref=${encodeURIComponent(branch)}`;

  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) {
    return {
      content: `Directory not found: ${displayPath}`,
      is_error: true,
      summary: `Listed ${displayPath} — Directory not found`,
    };
  }
  if (!res.ok) {
    const body = await res.text();
    return {
      content: `GitHub error ${res.status}: ${body.slice(0, 200)}`,
      is_error: true,
      summary: `Listed ${displayPath} — GitHub ${res.status}`,
    };
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    return {
      content: `Path is a file, not a directory: ${displayPath}`,
      is_error: true,
      summary: `Listed ${displayPath} — Not a directory`,
    };
  }
  const entries = data as ContentsListEntry[];
  const dirs = entries
    .filter((e) => e.type === "dir")
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((e) => e.type === "file")
    .sort((a, b) => a.name.localeCompare(b.name));
  const others = entries.filter((e) => e.type !== "dir" && e.type !== "file");

  const lines: string[] = [];
  for (const d of dirs) lines.push(`${d.name}/`);
  for (const f of files) {
    const size = typeof f.size === "number" ? humanSize(f.size) : "?";
    lines.push(`${f.name} (${size})`);
  }
  for (const o of others) {
    lines.push(`${o.name} (${o.type})`);
  }

  return {
    content: lines.length > 0 ? lines.join("\n") : "(empty directory)",
    summary: `Listed ${displayPath}`,
  };
}

/**
 * read_repo_file — single file read via the Contents API. UTF-8 decode.
 * Refuses files >MAX_FILE_BYTES and files that can't be decoded as text.
 */
export async function readRepoFile(
  env: Env,
  repoFullName: string,
  branch: string,
  input: Record<string, unknown>,
): Promise<ToolResultWithSummary> {
  const path = typeof input.path === "string" ? input.path.trim() : "";
  if (!path) {
    return {
      content: "Path is required.",
      is_error: true,
      summary: "Read — Path required",
    };
  }
  const url = `${API}/repos/${repoFullName}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) {
    return {
      content: `File not found: ${path}`,
      is_error: true,
      summary: `Read ${path} — File not found`,
    };
  }
  if (!res.ok) {
    const body = await res.text();
    return {
      content: `GitHub error ${res.status}: ${body.slice(0, 200)}`,
      is_error: true,
      summary: `Read ${path} — GitHub ${res.status}`,
    };
  }
  const data = (await res.json()) as {
    content: string;
    encoding: string;
    size: number;
    type: string;
  };
  if (data.type !== "file") {
    return {
      content: `Not a file: ${path}`,
      is_error: true,
      summary: `Read ${path} — Not a file`,
    };
  }
  if (data.size > MAX_FILE_BYTES) {
    const size = humanSize(data.size);
    return {
      content:
        `File too large (${size}) — reads are capped at ${humanSize(MAX_FILE_BYTES)}. ` +
        `Ask the user to share what's relevant.`,
      is_error: true,
      summary: `Read ${path} — File too large: ${size}`,
    };
  }
  if (data.encoding !== "base64") {
    return {
      content: `Unexpected encoding ${data.encoding} for ${path}.`,
      is_error: true,
      summary: `Read ${path} — Unexpected encoding`,
    };
  }
  let text: string;
  try {
    const binary = atob(data.content.replace(/\n/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return {
      content: `File ${path} is not text (couldn't decode as UTF-8).`,
      is_error: true,
      summary: `Read ${path} — Not text`,
    };
  }
  return {
    content: `${path}\n\n${text}`,
    summary: `Read ${path} (${humanSize(data.size)})`,
  };
}

/**
 * read_repo_files — batch read of up to MAX_BATCH_FILES files in parallel.
 * Returns one concatenated text block with per-file headers. Per-file errors
 * surface inline as "ERROR: ..." rather than failing the whole call.
 */
export async function readRepoFiles(
  env: Env,
  repoFullName: string,
  branch: string,
  input: Record<string, unknown>,
): Promise<ToolResultWithSummary> {
  const paths = Array.isArray(input.paths)
    ? input.paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : [];
  if (paths.length === 0) {
    return {
      content: "Pass at least one path in `paths`.",
      is_error: true,
      summary: "Read 0 files — At least one path required",
    };
  }
  if (paths.length > MAX_BATCH_FILES) {
    return {
      content: `Too many paths (${paths.length}). Cap is ${MAX_BATCH_FILES} per call.`,
      is_error: true,
      summary: `Read ${paths.length} files — Too many (cap ${MAX_BATCH_FILES})`,
    };
  }
  const results = await Promise.all(
    paths.map((p) => readRepoFile(env, repoFullName, branch, { path: p })),
  );
  const blocks: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const p = paths[i]!;
    const r = results[i]!;
    blocks.push(`=== ${p} ===`);
    if (r.is_error) {
      // r.content already says "File not found: X" etc.; pass it through
      blocks.push(`ERROR: ${r.content}`);
    } else {
      // readRepoFile prefixes content with "path\n\n"; strip the duplicate header
      const text = r.content.startsWith(`${p}\n\n`) ? r.content.slice(p.length + 2) : r.content;
      blocks.push(text);
    }
    blocks.push("");
  }
  return {
    content: blocks.join("\n"),
    summary: `Read ${paths.length} files`,
  };
}
