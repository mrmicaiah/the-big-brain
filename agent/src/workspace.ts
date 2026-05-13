// Ensure a project's local checkout exists; capture a unified git diff after
// a Claude Code run.
//
// "Capture diff" works by `git add -A` to stage all changes (including
// untracked files), running `git diff --cached --stat` and `git diff
// --cached`, then `git reset` to unstage. The user reviews the unstaged
// changes interactively in their tools and pushes manually.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { log } from "./log.js";

export interface WorkspaceResult {
  path: string;
  isFresh: boolean;
}

export function ensureWorkspace(
  reposDir: string,
  repoName: string,
  cloneUrl: string | null,
): WorkspaceResult {
  if (!repoName) throw new Error("repoName is required");
  if (!/^[a-zA-Z0-9._-]+$/.test(repoName)) {
    throw new Error(`refusing to use unsafe repo name: ${repoName}`);
  }

  if (!existsSync(reposDir)) {
    mkdirSync(reposDir, { recursive: true });
  } else if (!statSync(reposDir).isDirectory()) {
    throw new Error(`REPOS_DIR exists but is not a directory: ${reposDir}`);
  }

  const repoPath = join(reposDir, repoName);

  if (existsSync(repoPath)) {
    const gitDir = join(repoPath, ".git");
    if (!existsSync(gitDir)) {
      throw new Error(`${repoPath} exists but is not a git repo (.git missing)`);
    }
    return { path: repoPath, isFresh: false };
  }

  if (!cloneUrl) {
    throw new Error(
      `repo "${repoName}" not found at ${repoPath} and no clone_url provided`,
    );
  }

  log.info(`cloning ${cloneUrl} into ${repoPath}`);
  execFileSync("git", ["clone", cloneUrl, repoPath], { stdio: "inherit" });
  return { path: repoPath, isFresh: true };
}

const MAX_DIFF_BYTES = 200 * 1024;

export interface CapturedDiff {
  stat: string;
  diff: string;
  truncated: boolean;
}

/**
 * Capture all uncommitted changes (tracked + untracked) as a single diff.
 * Strategy: stage all → diff --cached --stat + diff --cached → unstage.
 * Leaves the working tree exactly as the worker left it, so the user can
 * review with their normal git tools and `git push` when they're happy.
 */
export function captureDiff(repoPath: string): CapturedDiff {
  // Stage every change (including untracked files). Errors here aren't fatal —
  // a repo with nothing to add will still report an empty diff.
  safeGit(repoPath, ["add", "-A"]);

  const stat = safeGit(repoPath, ["diff", "--cached", "--stat"]) ?? "";
  let diff = safeGit(repoPath, ["diff", "--cached"]) ?? "";

  // Unstage so the user can review interactively.
  safeGit(repoPath, ["reset"]);

  const truncated = diff.length > MAX_DIFF_BYTES;
  if (truncated) diff = diff.slice(0, MAX_DIFF_BYTES);
  return { stat: stat.trim(), diff, truncated };
}

function safeGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err) {
    log.warn(`git ${args.join(" ")} failed:`, (err as Error).message);
    return null;
  }
}
