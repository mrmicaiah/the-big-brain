import MANAGER_PROMPT_TEMPLATE from "../../prompts/manager.md";

export interface ManagerPromptArgs {
  projectId: string;
  repoFullName: string;
  cloneUrl: string;
  ceoFiles: {
    goal: string;
    context: string;
    decisions: string;
    board: string;
  };
  /** Optional pre-formatted "Recent worker results you haven't reviewed"
   *  block (Phase 4). Empty string = no unseen jobs; skip the section. */
  workerResults?: string;
}

/**
 * Assemble the manager system prompt. Format matches the template in
 * prompts/manager.md's own preamble.
 *
 * The `<recent worker job results, if any are unseen>` slot is now populated
 * by Phase 4's manager_seen_at fold-in (see manager.ts handleChat).
 */
export function buildManagerSystemPrompt(args: ManagerPromptArgs): string {
  const { projectId, repoFullName, cloneUrl, ceoFiles, workerResults } = args;
  const lines: string[] = [
    MANAGER_PROMPT_TEMPLATE,
    "",
    `## Current project: ${repoFullName}`,
    "",
    `Current project ID: ${projectId}`,
    `Repo: ${cloneUrl}`,
    "",
    "### Goal",
    ceoFiles.goal || "(empty)",
    "",
    "### Context",
    ceoFiles.context || "(empty)",
    "",
    "### Recent decisions",
    ceoFiles.decisions || "(empty)",
    "",
    "### Board",
    ceoFiles.board || "(empty)",
    "",
  ];
  if (workerResults && workerResults.trim().length > 0) {
    lines.push(workerResults);
  }
  return lines.join("\n");
}

/**
 * Format unseen terminal job rows as a "Recent worker results you haven't
 * reviewed" markdown block for the system prompt. Each row gets job id,
 * status, summary, diff stat, and a truncated diff body.
 */
export interface UnseenJobRow {
  id: string;
  summary: string;
  status: "succeeded" | "failed";
  diff_summary: string | null;
}

const MAX_DIFF_IN_PROMPT = 8000;

export function formatUnseenJobs(jobs: UnseenJobRow[]): string {
  if (jobs.length === 0) return "";
  const lines: string[] = ["", "## Recent worker results you haven't reviewed", ""];
  for (const job of jobs) {
    let parsed: Record<string, unknown> = {};
    if (job.diff_summary) {
      try {
        parsed = JSON.parse(job.diff_summary) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
    }
    lines.push(`### Job ${job.id} (${job.status})`);
    if (job.summary) lines.push(job.summary);
    if (job.status === "succeeded") {
      const diffStat = typeof parsed.diffStat === "string" ? parsed.diffStat : "";
      const diff = typeof parsed.diff === "string" ? parsed.diff : "";
      if (diffStat) {
        lines.push("");
        lines.push("```");
        lines.push(diffStat.trim());
        lines.push("```");
      }
      if (diff) {
        lines.push("");
        lines.push("```diff");
        lines.push(diff.slice(0, MAX_DIFF_IN_PROMPT));
        if (diff.length > MAX_DIFF_IN_PROMPT) lines.push("... (diff truncated)");
        lines.push("```");
      }
    } else {
      const stage = typeof parsed.stage === "string" ? parsed.stage : "?";
      const error = typeof parsed.error === "string" ? parsed.error : "?";
      lines.push("");
      lines.push(`Failed at stage **${stage}**: ${error}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
